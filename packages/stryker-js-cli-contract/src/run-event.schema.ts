import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Plugin, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { Effect, SchemaGetter } from 'effect'
import * as S from 'effect/Schema'

import { ModeSignal, OutputMode } from './output-mode.schema.js'
import { PluginLoadFailureReason } from './plugin-load-failure-reason.schema.js'
import { ShardPlan as ShardPlanDocument } from './shard-plan.schema.js'
import { StreamSchemaVersion } from './stream-version.schema.js'

export const RunPhase = S.Literals(['prepare', 'instrument', 'dry-run', 'mutation-test', 'reporting'])
export type RunPhase = typeof RunPhase.Type

export const RunId = S.String.pipe(
  S.check(S.isPattern(/^[0-9A-HJKMNP-TV-Z]{26}$/u)),
  S.brand('RunId'),
)
export type RunId = typeof RunId.Type

export class RunStarted extends S.TaggedClass<RunStarted>()('stream', {
  schemaVersion: StreamSchemaVersion,
  runId: RunId,
  mode: OutputMode,
  signal: ModeSignal,
}) {}

export class PhaseEntered extends S.TaggedClass<PhaseEntered>()('phase', {
  phase: RunPhase,
  elapsedMs: Report.NonNegativeFinite,
}) {}

export const ReuseRefusals = S.Struct({
  semanticsChanged: Report.NonNegativeInt,
  policyChanged: Report.NonNegativeInt,
  runInputsChanged: Report.NonNegativeInt,
  closureChanged: Report.NonNegativeInt,
  closureAnalysisFailed: S.optionalKey(Report.NonNegativeInt),
  programChanged: S.optionalKey(Report.NonNegativeInt),
  timeoutUnreproduced: Report.NonNegativeInt,
  flakyDependency: Report.NonNegativeInt,
  noPriorRecord: Report.NonNegativeInt,
})
export type ReuseRefusals = typeof ReuseRefusals.Type

export const PlanReportDiscardReason = S.Literals([
  'noPriorRecord',
  'cacheLayoutChanged',
  'semanticsChanged',
  'policyChanged',
  'runInputsChanged',
])
export type PlanReportDiscardReason = typeof PlanReportDiscardReason.Type

/**
 * Why a whole incremental report was discarded before planning: its reason
 * vocabulary matches the engine's report admission, and `actual`/`expected`
 * repeat the mismatching identity when the reason names one.
 */
export const PlanReportDiscard = S.Struct({
  reason: PlanReportDiscardReason,
  actual: S.optionalKey(S.String),
  expected: S.String,
})
export type PlanReportDiscard = typeof PlanReportDiscard.Type

export const PlanProjectReuse = S.Struct({
  project: S.String,
  reused: Report.NonNegativeInt,
  ran: Report.NonNegativeInt,
  refused: ReuseRefusals,
  discard: S.optionalKey(PlanReportDiscard),
})
export type PlanProjectReuse = typeof PlanProjectReuse.Type

export class PlanKnown extends S.TaggedClass<PlanKnown>()('plan', {
  total: Report.NonNegativeInt,
  shardPlan: S.NullOr(ShardPlanDocument),
  projects: PlanProjectReuse.pipe(S.Array, S.optionalKey),
}) {}

export const WorkerRole = S.Literals(['testRunner', 'checker'])
export type WorkerRole = typeof WorkerRole.Type

export class WorkerReported extends S.TaggedClass<WorkerReported>()('worker', {
  schemaVersion: StreamSchemaVersion,
  role: WorkerRole,
  index: Report.NonNegativeInt,
  startupMs: Report.NonNegativeFinite,
}) {}

export const MutantCost = S.Struct({
  fixedOverheadMs: Report.NonNegativeFinite,
  testBodyMs: Report.NonNegativeFinite,
  testsExecuted: Report.NonNegativeInt,
  shared: S.Boolean,
})
export type MutantCost = typeof MutantCost.Type

/**
 * The machine-stream line a tested mutant is published as. Its wire shape is a
 * published contract: the `mutant` tag and the `file`/`mutator` keys must not
 * change. The line carries the verified fields of `Reporter.MutantTested` plus
 * the static classification (R24) and the measured cost breakdown (R39).
 */
export class RunMutantTestedEvent extends S.TaggedClass<RunMutantTestedEvent>()('mutantTested', {
  id: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
  fileName: Mutant.CanonicalFileName,
  location: Mutant.Location,
  mutatorName: Mutant.MutatorName,
  replacement: S.NullOr(S.String),
  completed: Report.NonNegativeInt,
  total: Report.NonNegativeInt,
  static: S.Boolean,
  cost: S.NullOr(MutantCost),
}) {}

export type RunMutantTested = RunMutantTestedEvent

const MutantTestedWireSchema = S.TaggedStruct('mutant', {
  id: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
  file: S.toType(Mutant.CanonicalFileName),
  location: Mutant.Location,
  mutator: Mutant.MutatorName,
  replacement: S.NullOr(S.String),
  completed: Report.NonNegativeInt,
  total: Report.NonNegativeInt,
  static: S.Boolean,
  cost: S.NullOr(MutantCost),
})

export const RunMutantTested: S.Codec<RunMutantTested, typeof MutantTestedWireSchema.Encoded> = MutantTestedWireSchema
  .pipe(
    S.decodeTo(S.toType(RunMutantTestedEvent), {
      decode: SchemaGetter.transform((line) =>
        RunMutantTestedEvent.make({
          id: line.id,
          status: line.status,
          fileName: line.file,
          location: line.location,
          mutatorName: line.mutator,
          replacement: line.replacement,
          completed: line.completed,
          total: line.total,
          static: line.static,
          cost: line.cost,
        })
      ),
      encode: SchemaGetter.transform((tested) => ({
        _tag: 'mutant' as const,
        id: tested.id,
        status: tested.status,
        file: tested.fileName,
        location: tested.location,
        mutator: tested.mutatorName,
        replacement: tested.replacement,
        completed: tested.completed,
        total: tested.total,
        static: tested.static,
        cost: tested.cost,
      })),
    }),
  )

export class Heartbeat extends S.TaggedClass<Heartbeat>()('tick', {
  elapsedMs: Report.NonNegativeFinite,
  completed: Report.NonNegativeInt,
  total: S.NullOr(Report.NonNegativeInt),
}) {}

export const VerdictLocation = S.Struct({ start: Mutant.Position, end: Mutant.Position })
export type VerdictLocation = typeof VerdictLocation.Type

export const VerdictThresholds = S.Struct({
  high: Report.Percentage,
  low: Report.Percentage,
  break: S.NullOr(Report.Percentage),
})
export type VerdictThresholds = typeof VerdictThresholds.Type

export const VerdictMutant = S.Struct({
  id: S.String,
  file: S.String,
  location: VerdictLocation,
  mutator: S.String,
  replacement: S.NullOr(S.String),
  status: Mutant.MutantStatusSchema,
})
export type VerdictMutant = typeof VerdictMutant.Type

export type VerdictCounts = Report.Metrics

export const RunScope = S.Literals(['full', 'diff'])
export type RunScope = typeof RunScope.Type

export const MutantSetPolicy = S.Literals(['default', 'full'])
export type MutantSetPolicy = typeof MutantSetPolicy.Type

export const IncrementalMode = S.Literals(['incremental', 'full'])
export type IncrementalMode = typeof IncrementalMode.Type

export const CheckDuration = S.Union([
  S.TaggedStruct('measured', { ms: Report.NonNegativeFinite }),
  S.TaggedStruct('not-run', {}),
  S.TaggedStruct('not-recorded', {}),
])
export type CheckDuration = typeof CheckDuration.Type

export const ReportingDuration = S.Union([
  S.TaggedStruct('measured', { ms: Report.NonNegativeFinite }),
  S.TaggedStruct('not-recorded', {}),
])
export type ReportingDuration = typeof ReportingDuration.Type

export const PhaseDurations = S.Struct({
  prepare: Report.NonNegativeFinite,
  instrument: Report.NonNegativeFinite,
  'dry-run': Report.NonNegativeFinite,
  'mutation-test': Report.NonNegativeFinite,
  check: CheckDuration.pipe(S.withDecodingDefaultKey(Effect.succeed({ _tag: 'not-recorded' as const }))),
  reporting: ReportingDuration.pipe(S.withDecodingDefaultKey(Effect.succeed({ _tag: 'not-recorded' as const }))),
})
export type PhaseDurations = typeof PhaseDurations.Type

export const StaticVerdict = S.Struct({
  count: Report.NonNegativeInt,
  costMs: Report.NonNegativeFinite,
})
export type StaticVerdict = typeof StaticVerdict.Type

export const Budget = S.Struct({
  predictedSeconds: Report.NonNegativeFinite,
  actualSeconds: Report.NonNegativeFinite,
})
export type Budget = typeof Budget.Type

export class VerdictReached extends S.TaggedClass<VerdictReached>()('verdict', {
  schemaVersion: StreamSchemaVersion,
  runId: RunId,
  mode: OutputMode,
  signal: ModeSignal,
  score: S.NullOr(Report.Percentage),
  thresholds: VerdictThresholds,
  reportFile: S.NullOr(S.String),
  counts: Report.Metrics,
  mutants: S.Array(VerdictMutant),
  scope: RunScope,
  mutantSetPolicy: MutantSetPolicy,
  incrementalMode: S.optionalKey(IncrementalMode),
  phaseDurations: S.NullOr(PhaseDurations),
  static: S.NullOr(StaticVerdict),
  budget: Budget,
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

export class ReuseReported extends S.TaggedClass<ReuseReported>()('reuse', {
  reused: Report.NonNegativeInt,
  ran: Report.NonNegativeInt,
  refused: ReuseRefusals,
}) {}

export class TceReported extends S.TaggedClass<TceReported>()('tce', {
  equivalentToOriginal: Report.NonNegativeInt,
  duplicateAtSite: Report.NonNegativeInt,
}) {}

export class MutantDetailReported extends S.TaggedClass<MutantDetailReported>()('mutant-detail', {
  id: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
  coveringTests: S.Array(S.String),
  killedBy: S.NullOr(S.String),
  reproducer: S.NullOr(S.String),
}) {}

export const FeedbackJudgment = S.Literals(['useful', 'not-useful'])
export type FeedbackJudgment = typeof FeedbackJudgment.Type

export class FeedbackReported extends S.TaggedClass<FeedbackReported>()('feedback', {
  id: Mutant.MutantId,
  judgment: FeedbackJudgment,
  reason: S.NullOr(S.String),
}) {}

export class RunFailed extends S.TaggedClass<RunFailed>()('error', {
  schemaVersion: StreamSchemaVersion,
  code: Plugin.ExitCode,
  error: S.String,
  remediation: S.String,
  reason: S.NullOr(PluginLoadFailureReason),
}) {}

export class HelpRendered extends S.TaggedClass<HelpRendered>()('help', {
  schemaVersion: StreamSchemaVersion,
  code: S.Literals([0]),
  help: S.String,
}) {}

export const RefusalRule = S.Literal('mutation-runs-on-main-ci')
export type RefusalRule = typeof RefusalRule.Type

export class Refused extends S.TaggedClass<Refused>()('refused', {
  schemaVersion: StreamSchemaVersion,
  rule: RefusalRule,
  message: S.String,
}) {}
export const RunEvent = Object.assign(
  S.Union([
    RunStarted,
    PhaseEntered,
    PlanKnown,
    WorkerReported,
    RunMutantTested,
    Heartbeat,
    PluginsReported,
    FormatRegistryResolved,
    SkippedReported,
    ReuseReported,
    TceReported,
    MutantDetailReported,
    FeedbackReported,
    VerdictReached,
    RunFailed,
    HelpRendered,
    Refused,
  ]),
  { QUEUE_BOUND: 256 },
)
export type RunEvent = typeof RunEvent.Type

export type RunTerminalEvent = VerdictReached | RunFailed | HelpRendered | Refused
