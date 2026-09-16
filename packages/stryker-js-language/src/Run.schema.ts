import * as S from 'effect/Schema'

import { LocationSchema, MutantStatusSchema } from './Report.schema.js'

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
  elapsedMs: S.Finite,
}) {}

export class PlanKnown extends S.TaggedClass<PlanKnown>()('plan', {
  total: S.Finite,
}) {}

export class RunMutantTested extends S.TaggedClass<RunMutantTested>()('mutant', {
  id: S.String,
  status: MutantStatusSchema,
  file: S.String,
  location: LocationSchema,
  mutator: S.String,
  replacement: S.NullOr(S.String),
  completed: S.Finite,
  total: S.Finite,
}) {}

export class Heartbeat extends S.TaggedClass<Heartbeat>()('tick', {
  elapsedMs: S.Finite,
  completed: S.Finite,
  total: S.NullOr(S.Finite),
}) {}

export const PluginDescriptorOutcome = S.Literals(['loaded', 'absent', 'failed', 'undescribed'])
export type PluginDescriptorOutcome = typeof PluginDescriptorOutcome.Type

export const PluginContributionRow = S.Struct({
  kind: S.String,
  name: S.String,
})
export type PluginContributionRow = typeof PluginContributionRow.Type

export const PluginDescriptorRow = S.Struct({
  moduleName: S.String,
  outcome: PluginDescriptorOutcome,
  contributions: S.Array(PluginContributionRow),
})
export type PluginDescriptorRow = typeof PluginDescriptorRow.Type

export const PluginShadowingRow = S.Union([
  S.TaggedStruct('name', {
    kind: S.String,
    name: S.String,
    winnerModule: S.String,
    loserModule: S.String,
  }),
  S.TaggedStruct('extension', {
    kind: S.String,
    formatId: S.String,
    extension: S.String,
    winnerModule: S.String,
    loserModule: S.String,
  }),
])
export type PluginShadowingRow = typeof PluginShadowingRow.Type

export const FormatRegistryRow = S.Struct({
  extension: S.String,
  formatId: S.String,
  ownerModule: S.String,
})
export type FormatRegistryRow = typeof FormatRegistryRow.Type

export const SkippedFileRow = S.Struct({
  file: S.String,
  extension: S.String,
  reason: S.String,
})
export type SkippedFileRow = typeof SkippedFileRow.Type

export class PluginsReported extends S.TaggedClass<PluginsReported>()('plugins', {
  descriptors: S.Array(PluginDescriptorRow),
  shadowings: S.Array(PluginShadowingRow),
}) {}

export class FormatRegistryResolved extends S.TaggedClass<FormatRegistryResolved>()('formats', {
  rows: S.Array(FormatRegistryRow),
}) {}

export class SkippedReported extends S.TaggedClass<SkippedReported>()('skipped', {
  files: S.Array(SkippedFileRow),
}) {}

const VerdictThresholds = S.Struct({
  high: S.Finite,
  low: S.Finite,
  break: S.NullOr(S.Finite),
})
export type VerdictThresholds = typeof VerdictThresholds.Type

const VerdictMutant = S.Struct({
  id: S.String,
  file: S.String,
  location: LocationSchema,
  mutator: S.String,
  replacement: S.NullOr(S.String),
  status: MutantStatusSchema,
})
export type VerdictMutant = typeof VerdictMutant.Type

const VerdictCounts = S.Struct({
  killed: S.Finite,
  timeout: S.Finite,
  survived: S.Finite,
  noCoverage: S.Finite,
  runtimeErrors: S.Finite,
  compileErrors: S.Finite,
  ignored: S.Finite,
  pending: S.Finite,
})
export type VerdictCounts = typeof VerdictCounts.Type

export class VerdictReached extends S.TaggedClass<VerdictReached>()('verdict', {
  schemaVersion: S.String,
  runId: S.String,
  mode: OutputMode,
  signal: ModeSignal,
  score: S.NullOr(S.Finite),
  thresholds: VerdictThresholds,
  reportFile: S.NullOr(S.String),
  counts: VerdictCounts,
  mutants: S.Array(VerdictMutant),
}) {}

export const PluginFailureReason = S.Literals([
  'PeerMissing',
  'PeerVersionUnsupported',
  'InvalidContribution',
  'ImportFailed',
  'PluginNotFound',
])
export type PluginFailureReason = typeof PluginFailureReason.Type

export class RunFailed extends S.TaggedClass<RunFailed>()('error', {
  schemaVersion: S.String,
  code: S.Finite,
  error: S.String,
  remediation: S.String,
  reason: S.optional(PluginFailureReason),
}) {}

export class HelpRendered extends S.TaggedClass<HelpRendered>()('help', {
  schemaVersion: S.String,
  code: S.Literals([0]),
  help: S.String,
}) {}

export const RunEvent = S.Union([
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
])
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
