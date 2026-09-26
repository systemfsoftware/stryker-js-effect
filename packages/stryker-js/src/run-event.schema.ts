/// <reference types="vitest/importMeta" />
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import { SchemaGetter, SchemaTransformation } from 'effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const RunPhase = S.Literals(['prepare', 'instrument', 'dry-run', 'mutation-test'])
export type RunPhase = typeof RunPhase.Type

export const OutputMode = S.Literals(['human', 'machine'])
export type OutputMode = typeof OutputMode.Type

export const ModeSignal = S.Literals(['flag', 'env', 'tty', 'agent', 'tool'])
export type ModeSignal = typeof ModeSignal.Type

export class RunStarted extends S.TaggedClass<RunStarted>()('stream', {
  schemaVersion: S.String,
  runId: S.String,
  mode: OutputMode,
  signal: ModeSignal,
}) {}

export class PhaseEntered extends S.TaggedClass<PhaseEntered>()('phase', {
  phase: RunPhase,
  elapsedMs: Report.NonNegativeFinite,
}) {}

export class PlanKnown extends S.TaggedClass<PlanKnown>()('plan', {
  total: Report.NonNegativeInt,
}) {}

export class RunMutantTested extends S.TaggedClass<RunMutantTested>()('mutant', {
  id: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
  file: S.String,
  location: Mutant.LocationSchema,
  mutator: S.String,
  replacement: S.NullOr(S.String),
  completed: Report.NonNegativeInt,
  total: Report.NonNegativeInt,
}) {}

export class Heartbeat extends S.TaggedClass<Heartbeat>()('tick', {
  elapsedMs: Report.NonNegativeFinite,
  completed: Report.NonNegativeInt,
  total: S.NullOr(Report.NonNegativeInt),
}) {}

const VerdictThresholdsValuesSchema = S.Struct({
  high: Report.Percentage,
  low: Report.Percentage,
  break: S.NullOr(Report.Percentage),
})
export type VerdictThresholds = typeof VerdictThresholdsValuesSchema.Type

const isVerdictThresholds = (value: unknown): value is VerdictThresholds =>
  S.is(VerdictThresholdsValuesSchema)(value) && value.low <= value.high

/**
 * The pair is *built* ordered — a drawn pair is sorted — rather than drawn at
 * random and discarded until it happens to be ordered. The invariant lives on
 * the declaration because a filter over the pair cannot express `low <= high`
 * in the generation-constraint vocabulary, and only a declaration carries a
 * `toCodecArbitrary` derivation. The struct stays the wire side, so decoding
 * keeps its field paths.
 */
const OrderedVerdictThresholds = S.declare<VerdictThresholds>(isVerdictThresholds, {
  message: 'expected thresholds where low <= high',
  toCodecArbitrary: () =>
    S.link<VerdictThresholds>()(VerdictThresholdsValuesSchema, {
      decode: SchemaGetter.transform(({ break: breaking, high, low }) => ({
        break: breaking,
        high: Math.max(high, low),
        low: Math.min(high, low),
      })),
      encode: SchemaGetter.transform((thresholds) => thresholds),
    }),
})

const VerdictThresholds = VerdictThresholdsValuesSchema.pipe(
  S.decodeTo(OrderedVerdictThresholds, SchemaTransformation.passthrough()),
)

const VerdictMutant = S.Struct({
  id: Mutant.MutantId,
  file: S.String,
  location: Mutant.LocationSchema,
  mutator: S.String,
  replacement: S.NullOr(S.String),
  status: Mutant.MutantStatusSchema,
})
export type VerdictMutant = typeof VerdictMutant.Type

export type VerdictCounts = Report.Metrics
export class VerdictReached extends S.TaggedClass<VerdictReached>()('verdict', {
  schemaVersion: S.String,
  runId: S.String,
  mode: OutputMode,
  signal: ModeSignal,
  score: S.NullOr(Report.Percentage),
  thresholds: VerdictThresholds,
  reportFile: S.NullOr(S.String),
  counts: Report.Metrics,
  mutants: S.Array(VerdictMutant),
}) {}

export const FrameworkContributionRow = S.Struct({
  name: S.String,
  formatId: S.String,
  extensions: S.Array(S.String),
})
export type FrameworkContributionRow = typeof FrameworkContributionRow.Type

export const FrameworkModuleRow = S.Struct({
  moduleName: S.String,
  contributions: S.Array(FrameworkContributionRow),
})
export type FrameworkModuleRow = typeof FrameworkModuleRow.Type

export const FormatClaimShadowingRow = S.Struct({
  extension: S.String,
  winner: S.String,
  loser: S.String,
})
export type FormatClaimShadowingRow = typeof FormatClaimShadowingRow.Type

export class PluginsReported extends S.TaggedClass<PluginsReported>()('plugins', {
  modules: S.Array(FrameworkModuleRow),
  shadowings: S.Array(FormatClaimShadowingRow),
}) {}

export const FormatRegistryRow = S.Struct({
  extension: S.String,
  formatId: S.String,
  ownerModule: S.String,
  language: S.String,
})
export type FormatRegistryRow = typeof FormatRegistryRow.Type

export class FormatRegistryResolved extends S.TaggedClass<FormatRegistryResolved>()('formats', {
  rows: S.Array(FormatRegistryRow),
}) {}

export const SkippedFileRow = S.Struct({
  file: S.String,
  extension: S.String,
  reason: S.String,
})
export type SkippedFileRow = typeof SkippedFileRow.Type

export class SkippedReported extends S.TaggedClass<SkippedReported>()('skipped', {
  files: S.Array(SkippedFileRow),
}) {}

export const PluginFailureReason = S.Literals([
  'PeerMissing',
  'PeerVersionUnsupported',
  'PeerUnrecognized',
  'InvalidContribution',
  'ImportFailed',
])
export type PluginFailureReason = typeof PluginFailureReason.Type

export class RunFailed extends S.TaggedClass<RunFailed>()('error', {
  schemaVersion: S.String,
  code: S.Finite,
  error: S.String,
  remediation: S.String,
  reason: S.NullOr(PluginFailureReason),
}) {}

export class HelpRendered extends S.TaggedClass<HelpRendered>()('help', {
  schemaVersion: S.String,
  code: S.Literals([0]),
  help: S.String,
}) {}
export const RunEvent = Object.assign(
  S.Union([
    RunStarted,
    PhaseEntered,
    PlanKnown,
    RunMutantTested,
    Heartbeat,
    PluginsReported,
    FormatRegistryResolved,
    SkippedReported,
    VerdictReached,
    RunFailed,
    HelpRendered,
  ]),
  { QUEUE_BOUND: 256 },
)
export type RunEvent = typeof RunEvent.Type

export type RunTerminalEvent = VerdictReached | RunFailed | HelpRendered

export class RunCommand extends S.TaggedClass<RunCommand>()('RunCommand', {
  cliOptionsJson: S.String,
  targetMutatePatterns: S.Array(S.String),
}) {}

export class RunOutput extends S.TaggedClass<RunOutput>()('RunOutput', {
  verdictJson: S.String,
  exitCode: S.Finite,
}) {}

export class RunDecodeError extends S.TaggedError<RunDecodeError>()('RunDecodeError', {
  message: S.String,
}) {}

export class RunReadError extends S.TaggedError<RunReadError>()('RunReadError', {
  message: S.String,
}) {}

export class RunWriteError extends S.TaggedError<RunWriteError>()('RunWriteError', {
  message: S.String,
}) {}

const machineAlphabetOf = (event: Reporter.MutantTested): Option.Option<RunMutantTested> =>
  Option.flatMap(
    S.encodeOption(Reporter.MutantTested)(event),
    (encoded) => S.decodeOption(RunMutantTested)({ ...encoded, _tag: 'mutant' }),
  )

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const machineFieldsOf = (event: {
    readonly id: string
    readonly file: string
    readonly status: string
    readonly mutator: string
    readonly replacement: string | null
    readonly completed: number
    readonly total: number
  }): string =>
    JSON.stringify([event.id, event.file, event.status, event.mutator, event.replacement, event.completed, event.total])

  it.prop(
    '∀m_Tested_≡MachineAlphabet',
    { of: [Reporter.MutantTested], subject: machineAlphabetOf },
    (subject, [event]) =>
      Option.match(subject(event), {
        onNone: () => false,
        onSome: (runEvent) => machineFieldsOf(runEvent) === machineFieldsOf(event),
      }),
  )
}

export class PlanMutationRunCommand extends S.TaggedClass<PlanMutationRunCommand>()('PlanMutationRunCommand', {
  configMutatePatterns: S.Array(S.String),
  configMutatorNames: S.Array(S.String),
  targetMutatePatterns: S.Array(S.String),
  availableMutators: S.Array(S.String),
}) {}

export class MutationRunPlan extends S.TaggedClass<MutationRunPlan>()('MutationRunPlan', {
  mutatePatterns: S.Array(S.String),
  mutatorNames: S.Array(S.String),
}) {}
