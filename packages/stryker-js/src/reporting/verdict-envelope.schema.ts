/// <reference types="vitest/importMeta" />
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

import { ModeSignal, OutputMode } from '../run-event.schema.js'
import { VerdictEnvelopeSchemaVersion } from './stream-version.schema.js'

export const ActionableStatus = S.Literals(['Survived', 'NoCoverage', 'Timeout', 'RuntimeError'])
export type ActionableStatus = typeof ActionableStatus.Type

const isActionableStatus = S.is(ActionableStatus)

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

const runIdTextOf = (now: DateTime.Utc) => {
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

const RunIdText = S.String.pipe(S.check(S.isPattern(/^[0-9A-HJKMNP-TV-Z]{26}$/)))

export class RunId extends S.Class<RunId>('RunId')({ value: RunIdText }) {
  static readonly generate = (now: DateTime.Utc) => RunId.make({ value: runIdTextOf(now) })
}

export const VerdictMutant = S.Struct({
  id: Mutant.MutantId,
  file: S.String,
  location: Mutant.LocationSchema,
  mutator: S.String,
  replacement: S.NullOr(S.String),
  status: Mutant.MutantStatusSchema,
})
export type VerdictMutant = typeof VerdictMutant.Type

export const VerdictThresholds = S.Struct({
  high: Report.Percentage,
  low: Report.Percentage,
  break: S.NullOr(Report.Percentage),
})
export type VerdictThresholds = typeof VerdictThresholds.Type

export type VerdictCounts = typeof Report.MetricsSchema.Type

export class VerdictEnvelope extends S.Class<VerdictEnvelope>('VerdictEnvelope')({
  schemaVersion: S.String,
  runId: S.String,
  mode: OutputMode,
  signal: ModeSignal,
  score: S.NullOr(Report.Percentage),
  thresholds: VerdictThresholds,
  counts: Report.MetricsSchema,
  reportFile: S.NullOr(S.String),
  mutants: S.Array(VerdictMutant),
}) {
  static readonly build = dual<
    (
      mode: OutputMode,
      signal: ModeSignal,
      runId: string,
      basePath: string,
      pathService: Path.Path,
    ) => (report: Report.MutationTestResult) => VerdictEnvelope,
    (
      report: Report.MutationTestResult,
      mode: OutputMode,
      signal: ModeSignal,
      runId: string,
      basePath: string,
      pathService: Path.Path,
    ) => VerdictEnvelope
  >(
    (args) => args.length === 6,
    (report, mode, signal, runId, basePath, pathService) => {
      const metrics = Report.Metrics.fromMutants(Arr.flatMap(Object.values(report.files), (file) => file.mutants))
      const { jsonReporterFileName } = embeddedConfig(report)
      return VerdictEnvelope.make({
        schemaVersion: VerdictEnvelopeSchemaVersion.literal,
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
          break: breakThreshold(report.thresholds),
        },
        counts: metrics,
        reportFile: Option.getOrNull(
          Option.map(
            Option.filter(Option.fromUndefinedOr(jsonReporterFileName), () => metrics.totalMutants > 0),
            (fileName) => pathService.relative(basePath, fileName).replaceAll('\\', '/'),
          ),
        ),
        mutants: actionableMutants(report.files),
      })
    },
  )
}

function embeddedConfig(report: Report.MutationTestResult) {
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

function breakThreshold(thresholds: Report.Thresholds) {
  const ThresholdsBreakSchema = S.StructWithRest(
    S.Struct({
      break: S.optional(S.Union([S.Finite, S.Null])),
    }),
    [S.Record(S.String, S.Unknown)],
  )
  const decoded = S.decodeOption(ThresholdsBreakSchema)(thresholds)
  return Option.getOrNull(Option.flatMap(decoded, (value) => Option.fromNullishOr(value.break)))
}

const actionableMutants = (files: Report.MutationTestResult['files']): ReadonlyArray<VerdictMutant> =>
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

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Effect = await import('effect/Effect')
  const Path = await import('effect/Path')

  const pathService = Effect.runSync(Effect.provide(Path.Path, Path.layer))
  const fixedRunId = RunId.generate(DateTime.makeUnsafe(0)).value
  const mutantTotalOf = (report: Report.MutationTestResult) =>
    Object.values(report.files).reduce((total, file) => total + file.mutants.length, 0)

  it.prop(
    '∀r_Metrics_∈EveryMutantOnce',
    { of: [Report.MutationTestResultSchema], subject: VerdictEnvelope.build },
    (subject, [report]) => {
      const { counts } = subject(report, 'machine', 'flag', fixedRunId, '/base', pathService)
      return counts.totalMutants === mutantTotalOf(report)
    },
  )

  const ACTIONABLE_STATUSES: Record<string, true> = {
    Survived: true,
    NoCoverage: true,
    Timeout: true,
    RuntimeError: true,
  }

  const actionableIdsOf = (files: Report.FileResultDictionary): ReadonlyArray<string> =>
    Arr.flatMap(
      Object.values(files),
      (file) => file.mutants.filter((mutant) => ACTIONABLE_STATUSES[mutant.status] === true).map((mutant) => mutant.id),
    )

  const idsMatch = (observed: ReadonlyArray<VerdictMutant>, expected: ReadonlyArray<string>): boolean =>
    observed.length === expected.length && observed.every((mutant, index) => mutant.id === expected[index])

  const statusesActionable = (observed: ReadonlyArray<VerdictMutant>): boolean =>
    observed.every((mutant) => ACTIONABLE_STATUSES[mutant.status] === true)

  it.prop(
    '∀files_ActionableMutants_≡ActionableOnly',
    { of: [Report.FileResultDictionarySchema], subject: actionableMutants },
    (subject, [files]) => {
      const observed = subject(files)
      return idsMatch(observed, actionableIdsOf(files)) && statusesActionable(observed)
    },
  )

  it.prop(
    '∀t_RunIdTimePrefix_≡Deterministic',
    { of: [S.Int.check(S.isBetween({ minimum: 0, maximum: 2 ** 40 }))], subject: RunId.generate },
    (subject, [millis]) => {
      const now = DateTime.makeUnsafe(millis)
      return subject(now).value.slice(0, 9) === subject(now).value.slice(0, 9)
    },
  )

  it.prop(
    '∀bd_RunIdTimePrefix_≤ForLaterEpoch',
    {
      of: [
        S.Int.check(S.isBetween({ minimum: 0, maximum: 2 ** 40 - 2 ** 16 })),
        S.Int.check(S.isBetween({ minimum: 8, maximum: 2 ** 16 })),
      ],
      subject: RunId.generate,
    },
    (subject, [base, delta]) =>
      subject(DateTime.makeUnsafe(base)).value.slice(0, 9) <
        subject(DateTime.makeUnsafe(base + delta)).value.slice(0, 9),
  )
}
