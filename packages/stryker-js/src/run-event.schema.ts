import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Plugin, Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import { SchemaGetter } from 'effect'
import * as S from 'effect/Schema'

import { ModeSignal, OutputMode } from './output-mode.schema.js'
import { PluginLoadFailureReason } from './PluginsError.schema.js'
import { StreamSchemaVersion } from './reporting/stream-version.schema.js'

export const RunPhase = S.Literals(['prepare', 'instrument', 'dry-run', 'mutation-test'])
export type RunPhase = typeof RunPhase.Type

export const RunId = S.String.pipe(
  S.check(S.isPattern(/^[0-9A-HJKMNP-TV-Z]{26}$/)),
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

export class PlanKnown extends S.TaggedClass<PlanKnown>()('plan', {
  total: Report.NonNegativeInt,
}) {}

/**
 * The machine-stream line a tested mutant is published as. Its wire shape is a
 * published contract: the `mutant` tag and the `file`/`mutator` keys must not
 * change. The domain event it carries is `Reporter.MutantTested`, so the line is
 * a codec at the boundary rather than a second declaration of the same event.
 */
export interface RunMutantTested extends Reporter.MutantTested {}

const MutantTestedWireSchema = S.TaggedStruct('mutant', {
  id: S.String,
  status: Mutant.MutantStatusSchema,
  file: S.String,
  location: Mutant.Location,
  mutator: S.String,
  replacement: S.NullOr(S.String),
  completed: Report.NonNegativeInt,
  total: Report.NonNegativeInt,
})

export const RunMutantTested: S.Codec<RunMutantTested, S.Schema.Type<typeof MutantTestedWireSchema>> =
  MutantTestedWireSchema
    .pipe(
      S.decodeTo(Reporter.MutantTested, {
        decode: SchemaGetter.transform((line) => ({
          _tag: 'mutantTested' as const,
          id: line.id,
          status: line.status,
          fileName: line.file,
          location: line.location,
          mutatorName: line.mutator,
          replacement: line.replacement,
          completed: line.completed,
          total: line.total,
        })),
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
        })),
      }),
    )

export class Heartbeat extends S.TaggedClass<Heartbeat>()('tick', {
  elapsedMs: Report.NonNegativeFinite,
  completed: Report.NonNegativeInt,
  total: S.NullOr(Report.NonNegativeInt),
}) {}

export const VerdictMutant = S.Struct({
  id: Mutant.MutantId,
  file: S.String,
  location: Mutant.Location,
  mutator: S.String,
  replacement: S.NullOr(S.String),
  status: Mutant.MutantStatusSchema,
})
export type VerdictMutant = typeof VerdictMutant.Type

export type VerdictCounts = Report.Metrics
export class VerdictReached extends S.TaggedClass<VerdictReached>()('verdict', {
  schemaVersion: StreamSchemaVersion,
  runId: RunId,
  mode: OutputMode,
  signal: ModeSignal,
  score: S.NullOr(Report.Percentage),
  thresholds: Report.ThresholdsSchema,
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
  exitCode: Plugin.ExitCode,
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
