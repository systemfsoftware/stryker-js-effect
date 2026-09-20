import { LocationSchema, MutantStatusSchema } from '@systemfsoftware/stryker-js-instrumenter'
import { Metrics, NonNegativeFinite, NonNegativeInt, Percentage } from '@systemfsoftware/stryker-js-plugin-interface'
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
  elapsedMs: NonNegativeFinite,
}) {}

export class PlanKnown extends S.TaggedClass<PlanKnown>()('plan', {
  total: NonNegativeInt,
}) {}

export class RunMutantTested extends S.TaggedClass<RunMutantTested>()('mutant', {
  id: S.String,
  status: MutantStatusSchema,
  file: S.String,
  location: LocationSchema,
  mutator: S.String,
  replacement: S.NullOr(S.String),
  completed: NonNegativeInt,
  total: NonNegativeInt,
}) {}

export class Heartbeat extends S.TaggedClass<Heartbeat>()('tick', {
  elapsedMs: NonNegativeFinite,
  completed: NonNegativeInt,
  total: S.NullOr(NonNegativeInt),
}) {}

const VerdictThresholds = S.Struct({
  high: Percentage,
  low: Percentage,
  break: S.NullOr(Percentage),
}).pipe(
  S.check(
    S.makeFilter((t) => t.low <= t.high, {
      expected: 'thresholds where low <= high',
      arbitrary: {
        candidate: {
          make: (fc) =>
            fc
              .tuple(
                fc.float({ min: 0, max: 100, noNaN: true }),
                fc.float({ min: 0, max: 100, noNaN: true }),
                fc.option(fc.float({ min: 0, max: 100, noNaN: true }), { nil: null }),
              )
              .map(([a, b, brk]) => ({
                high: Math.max(a, b),
                low: Math.min(a, b),
                break: brk,
              })),
        },
      },
    }),
  ),
)
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

export type VerdictCounts = Metrics

export class VerdictReached extends S.TaggedClass<VerdictReached>()('verdict', {
  schemaVersion: S.String,
  runId: S.String,
  mode: OutputMode,
  signal: ModeSignal,
  score: S.NullOr(Percentage),
  thresholds: VerdictThresholds,
  reportFile: S.NullOr(S.String),
  counts: Metrics,
  mutants: S.Array(VerdictMutant),
}) {}

export class RunFailed extends S.TaggedClass<RunFailed>()('error', {
  schemaVersion: S.String,
  code: S.Finite,
  error: S.String,
  remediation: S.String,
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
