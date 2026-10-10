import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Run } from '@systemfsoftware/stryker-js-contracts'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const PlanRunConclusionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/PlanRunConclusion')
type PlanRunConclusionTypeId = typeof PlanRunConclusionTypeId

export const FailedRunOutcomeSchema = S.Union([
  Run.RunParseFailed,
  Run.RunSurvivorsRejected,
  Run.RunConfigFailed,
  Run.RunRefused,
  Run.RunFailed,
  Run.RunInterrupted,
])

export const RunOutcomeTag = S.Literals([
  'RunOk',
  'RunParseFailed',
  'RunSurvivorsRejected',
  'RunConfigFailed',
  'RunRefused',
  'RunFailed',
  'RunInterrupted',
])
export type RunOutcomeTag = typeof RunOutcomeTag.Type

export class PlanRunConclusionCommand extends S.TaggedClass<PlanRunConclusionCommand>()('PlanRunConclusionCommand', {
  command: Run.RunOutcomeCommand,
  machine: S.Boolean,
  exitCode: Plugin.ExitCode,
  outcome: RunOutcomeTag,
  error: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    machine: 'stryker.run_conclusion.machine',
    exitCode: 'stryker.run.exit_code',
    outcome: 'stryker.run.outcome',
    error: 'stryker.run.error',
  } as const
}

export class RunConclusionEmittedOk extends S.TaggedClass<RunConclusionEmittedOk>()('RunConclusionEmittedOk', {
  command: Run.RunOutcomeCommand,
}) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export class RunConclusionEmittedFailed extends S.TaggedClass<RunConclusionEmittedFailed>()(
  'RunConclusionEmittedFailed',
  {
    command: Run.RunOutcomeCommand,
    exitCode: Plugin.ExitCode,
  },
) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export class RunConclusionQuietOk extends S.TaggedClass<RunConclusionQuietOk>()('RunConclusionQuietOk', {}) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export class RunConclusionQuietFailed extends S.TaggedClass<RunConclusionQuietFailed>()('RunConclusionQuietFailed', {
  exitCode: Plugin.ExitCode,
  exitClass: S.Union([Plugin.ExitClass, RunOutcomeTag]),
  error: S.String,
}) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export const PlanRunConclusionDecision = S.Union([
  RunConclusionEmittedOk,
  RunConclusionEmittedFailed,
  RunConclusionQuietOk,
  RunConclusionQuietFailed,
])
export type PlanRunConclusionDecision = typeof PlanRunConclusionDecision.Type

const emittedOf = (command: PlanRunConclusionCommand): PlanRunConclusionDecision =>
  Boolean.match(command.exitCode === 0, {
    onTrue: () => RunConclusionEmittedOk.make({ command: command.command }),
    onFalse: () => RunConclusionEmittedFailed.make({ command: command.command, exitCode: command.exitCode }),
  })

const BASELINE_CLASSES: ReadonlyArray<readonly [Plugin.ExitCode, Plugin.ExitClass]> = Arr.filterMap(
  Plugin.ExitClass.literals,
  (exitClass) =>
    Result.fromOption(
      Option.map(S.decodeOption(Plugin.ExitCodeFromClass)(exitClass), (code) => [code, exitClass] as const),
      () => exitClass,
    ),
)

const baselineClassOf = (exitCode: Plugin.ExitCode): Option.Option<Plugin.ExitClass> =>
  Option.map(Arr.findFirst(BASELINE_CLASSES, ([code]) => code === exitCode), ([, exitClass]) => exitClass)

const exitClassNameOf = (command: PlanRunConclusionCommand): Plugin.ExitClass | RunOutcomeTag =>
  Option.getOrElse(baselineClassOf(command.exitCode), () => command.outcome)

const quietOf = (command: PlanRunConclusionCommand): PlanRunConclusionDecision =>
  Boolean.match(command.exitCode === 0, {
    onTrue: () => RunConclusionQuietOk.make({}),
    onFalse: () =>
      RunConclusionQuietFailed.make({
        exitCode: command.exitCode,
        exitClass: exitClassNameOf(command),
        error: command.error,
      }),
  })

const decide = (command: PlanRunConclusionCommand): Result.Result<PlanRunConclusionDecision, never> =>
  Result.succeed(
    Boolean.match(command.machine, {
      onTrue: () => emittedOf(command),
      onFalse: () => quietOf(command),
    }),
  )

export const planRunConclusion = Workflow.make({
  command: PlanRunConclusionCommand,
  decision: PlanRunConclusionDecision,
  error: S.Never,
  decide,
})
