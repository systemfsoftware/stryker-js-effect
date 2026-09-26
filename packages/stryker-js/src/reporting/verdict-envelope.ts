import { randomBytes } from '@noble/hashes/utils.js'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { ModeSignal, OutputMode } from '../output-mode.schema.js'
import { RunId, VerdictMutant } from '../run-event.schema.js'
import { StreamSchemaVersion } from './stream-version.schema.js'
import { VerdictEnvelope } from './verdict-envelope.schema.js'

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

export const runIdTextOf = (now: DateTime.Utc): string => {
  const epoch = DateTime.toEpochMillis(now)
  const bytes: ReadonlyArray<number> = [
    (epoch / 0x10000000000) % 0x100,
    (epoch / 0x100000000) % 0x100,
    (epoch / 0x1000000) % 0x100,
    (epoch / 0x10000) % 0x100,
    (epoch / 0x100) % 0x100,
    epoch % 0x100,
    ...randomBytes(10),
  ]
  const drained = Arr.reduce(bytes, { value: 0, bits: 0, chars: '' }, pushByte)
  return Match.value(drained.bits > 0).pipe(
    Match.when(true, () => drained.chars + CROCKFORD_BASE32[(drained.value << (5 - drained.bits)) & 0x1f]),
    Match.when(false, () => drained.chars),
    Match.exhaustive,
  )
}

export const generateRunId = (now: DateTime.Utc): RunId => RunId.make(runIdTextOf(now))

const isActionableStatus = S.is(Mutant.ActionableStatusSchema)

export const actionableMutants = (files: Report.MutationTestResult['files']): ReadonlyArray<VerdictMutant> =>
  Arr.flatMap(Object.entries(files), ([file, fileResult]) =>
    Arr.map(
      Arr.filter(fileResult.mutants, (mutant) => isActionableStatus(mutant.status)),
      (mutant) =>
        VerdictMutant.make({
          id: mutant.id,
          file,
          location: mutant.location,
          mutator: mutant.mutatorName,
          replacement: mutant.replacement ?? null,
          status: mutant.status,
        }),
    ))

const embeddedConfig = (report: Report.MutationTestResult) => {
  const JsonReporterSchema = S.Struct({ fileName: S.String })
  const EmbeddedConfigSchema = S.StructWithRest(
    S.Struct({ jsonReporter: S.optional(JsonReporterSchema) }),
    [S.Record(S.String, S.Unknown)],
  )
  const decoded = S.decodeUnknownOption(EmbeddedConfigSchema)(report.config)
  const jsonReporter = Option.flatMap(decoded, (config) => Option.fromUndefinedOr(config.jsonReporter))
  return {
    jsonReporterFileName: Option.getOrUndefined(Option.map(jsonReporter, (reporter) => reporter.fileName)),
  }
}

export const buildVerdictEnvelope: {
  (
    mode: OutputMode,
    signal: ModeSignal,
    runId: RunId,
    basePath: string,
    pathService: Path.Path,
  ): (report: Report.MutationTestResult) => VerdictEnvelope
  (
    report: Report.MutationTestResult,
    mode: OutputMode,
    signal: ModeSignal,
    runId: RunId,
    basePath: string,
    pathService: Path.Path,
  ): VerdictEnvelope
} = dual(
  (args) => args.length === 6,
  (
    report: Report.MutationTestResult,
    mode: OutputMode,
    signal: ModeSignal,
    runId: RunId,
    basePath: string,
    pathService: Path.Path,
  ): VerdictEnvelope => {
    const metrics = Report.metricsFromMutants(Arr.flatMap(Object.values(report.files), (file) => file.mutants))
    const { jsonReporterFileName } = embeddedConfig(report)
    return VerdictEnvelope.make({
      schemaVersion: StreamSchemaVersion.literal,
      runId,
      mode,
      signal,
      score: Report.MutationScore.match(metrics.mutationScore, {
        Scored: ({ percentage }) => percentage,
        Unscored: () => null,
      }),
      thresholds: {
        high: report.thresholds.high,
        low: report.thresholds.low,
        break: report.thresholds.break,
      },
      counts: metrics,
      reportFile: Option.getOrNull(
        Option.map(
          Option.filter(Option.fromUndefinedOr(jsonReporterFileName), () => metrics.totalMutants > 0),
          (fileName) => Mutant.CanonicalFileName.make(pathService.relative(basePath, fileName).replaceAll('\\', '/')),
        ),
      ),
      mutants: actionableMutants(report.files),
    })
  },
)
