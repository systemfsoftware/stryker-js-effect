import { randomBytes } from '@noble/hashes/utils.js'
import { LocationSchema, MutantStatusSchema } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantStatus } from '@systemfsoftware/stryker-js-instrumenter'
import {
  MetricsSchema,
  type MutationTestResult,
  type Thresholds,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { ModeSignal, OutputMode } from '../run-event.schema.js'
import { CalculateMetrics } from './calculate-metrics.schema.js'
import { VerdictEnvelopeSchemaVersion } from './stream-version.schema.js'

export const ActionableStatus = S.Literals(['Survived', 'NoCoverage', 'Timeout', 'RuntimeError'])
export type ActionableStatus = typeof ActionableStatus.Type

const isActionableStatus = S.is(ActionableStatus)

const runIdTextOf = (now: DateTime.Utc): string => {
  const epoch = DateTime.toEpochMillis(now)
  const bytes = [
    (epoch / 0x10000000000) % 0x100,
    (epoch / 0x100000000) % 0x100,
    (epoch / 0x1000000) % 0x100,
    (epoch / 0x10000) % 0x100,
    (epoch / 0x100) % 0x100,
    epoch % 0x100,
    ...randomBytes(10),
  ]
  const drained = bytes.reduce(pushByte, { value: 0, bits: 0, chars: '' })
  return Match.value(drained.bits > 0).pipe(
    Match.when(true, () => drained.chars + CROCKFORD_BASE32[(drained.value << (5 - drained.bits)) & 0x1f]),
    Match.when(false, () => drained.chars),
    Match.exhaustive,
  )
}

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

interface Base32Accumulator {
  readonly value: number
  readonly bits: number
  readonly chars: string
}

const emitQuint = (accumulator: Base32Accumulator): Base32Accumulator => {
  const bits = accumulator.bits - 5
  return {
    value: accumulator.value & ((1 << bits) - 1),
    bits,
    chars: accumulator.chars + CROCKFORD_BASE32[(accumulator.value >>> bits) & 0x1f],
  }
}

const drainQuints = (accumulator: Base32Accumulator): Base32Accumulator =>
  Match.value(accumulator.bits >= 5).pipe(
    Match.when(true, () => drainQuints(emitQuint(accumulator))),
    Match.when(false, () => accumulator),
    Match.exhaustive,
  )

const pushByte = (accumulator: Base32Accumulator, byte: number): Base32Accumulator =>
  drainQuints({ value: (accumulator.value << 8) | byte, bits: accumulator.bits + 8, chars: accumulator.chars })

export class RunId extends S.Class<RunId>('RunId')({ value: S.String }) {
  static readonly generate = (now: DateTime.Utc): RunId => RunId.make({ value: runIdTextOf(now) })
}

export const VerdictMutant = S.Struct({
  id: S.String,
  file: S.String,
  location: LocationSchema,
  mutator: S.String,
  replacement: S.NullOr(S.String),
  status: MutantStatusSchema,
})
export type VerdictMutant = typeof VerdictMutant.Type

export const VerdictThresholds = S.Struct({
  high: S.Finite,
  low: S.Finite,
  break: S.NullOr(S.Finite),
})
export type VerdictThresholds = typeof VerdictThresholds.Type

export type VerdictCounts = typeof MetricsSchema.Type

export class VerdictEnvelope extends S.Class<VerdictEnvelope>('VerdictEnvelope')({
  schemaVersion: S.String,
  runId: S.String,
  mode: OutputMode,
  signal: ModeSignal,
  score: S.NullOr(S.Finite),
  thresholds: VerdictThresholds,
  counts: MetricsSchema,
  reportFile: S.NullOr(S.String),
  mutants: S.Array(VerdictMutant),
}) {
  static readonly build = dual<
    (
      mode: OutputMode['Type'],
      signal: ModeSignal['Type'],
      runId: string,
      basePath: string,
      pathService: Path.Path,
    ) => (report: MutationTestResult) => VerdictEnvelope,
    (
      report: MutationTestResult,
      mode: OutputMode['Type'],
      signal: ModeSignal['Type'],
      runId: string,
      basePath: string,
      pathService: Path.Path,
    ) => VerdictEnvelope
  >(
    (args) => args.length === 6,
    (report, mode, signal, runId, basePath, pathService) => {
      const metrics = CalculateMetrics.of(report.files).metrics
      const { jsonReporterFileName } = embeddedConfig(report)
      return VerdictEnvelope.make({
        schemaVersion: VerdictEnvelopeSchemaVersion.literal,
        runId,
        mode,
        signal,
        score: Option.getOrNull(
          Option.filter(
            Option.some(metrics.mutationScore),
            (score) => metrics.totalMutants > 0 && Number.isFinite(score),
          ),
        ),
        thresholds: {
          high: report.thresholds.high,
          low: report.thresholds.low,
          break: breakThreshold(report.thresholds),
        },
        counts: metrics,
        reportFile: Option.getOrNull(
          Option.map(
            Option.filter(Option.fromUndefinedOr(jsonReporterFileName), () => metrics.totalMutants > 0),
            (fileName) => normalizeFileName(pathService.relative(basePath, fileName)),
          ),
        ),
        mutants: actionableMutants(report.files),
      })
    },
  )
}

const normalizeFileName = (fileName: string): string => fileName.replaceAll('\\', '/')

function embeddedConfig(report: MutationTestResult): {
  readonly jsonReporterFileName: string | undefined
} {
  const JsonReporterSchema = S.Struct({
    fileName: S.String,
  })
  const EmbeddedConfigSchema = S.StructWithRest(
    S.Struct({
      jsonReporter: S.optional(JsonReporterSchema),
    }),
    [S.Record(S.String, S.Unknown)],
  )
  const decoded = S.decodeUnknownOption(EmbeddedConfigSchema)(report.config)
  const jsonReporter = Option.flatMap(decoded, (config) => Option.fromUndefinedOr(config.jsonReporter))
  return {
    jsonReporterFileName: Option.getOrUndefined(Option.map(jsonReporter, (reporter) => reporter.fileName)),
  }
}

function breakThreshold(thresholds: Thresholds): number | null {
  const ThresholdsBreakSchema = S.StructWithRest(
    S.Struct({
      break: S.optional(S.Union([S.Finite, S.Null])),
    }),
    [S.Record(S.String, S.Unknown)],
  )
  const decoded = S.decodeOption(ThresholdsBreakSchema)(thresholds)
  return Option.getOrNull(Option.flatMap(decoded, (value) => Option.fromNullishOr(value.break)))
}

const actionableMutants = (files: MutationTestResult['files']): readonly VerdictMutant[] =>
  Object.entries(files).flatMap(([file, fileResult]) =>
    fileResult.mutants
      .filter((mutant) => isActionableStatus(mutant.status))
      .map((mutant): VerdictMutant => ({
        id: mutant.id,
        file,
        location: mutant.location,
        mutator: mutant.mutatorName,
        replacement: mutant.replacement ?? null,
        status: mutant.status,
      })),
  )
