import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  RunConfigFailed,
  RunFailed,
  RunInterrupted,
  RunParseFailed,
  RunSurvivorsRejected,
} from './classify-run-outcome.workflow.js'
import { RunOutcomeCommand } from './RunOutcomeCommand.schema.js'

const PlanRunConclusionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/PlanRunConclusion')
type PlanRunConclusionTypeId = typeof PlanRunConclusionTypeId

export const FailedRunOutcomeSchema = S.Union([
  RunParseFailed,
  RunSurvivorsRejected,
  RunConfigFailed,
  RunFailed,
  RunInterrupted,
])

export class PlanRunConclusionCommand extends S.TaggedClass<PlanRunConclusionCommand>()('PlanRunConclusionCommand', {
  command: RunOutcomeCommand,
  machine: S.Boolean,
  exitCode: S.Finite,
  outcome: S.String,
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
  command: RunOutcomeCommand,
}) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export class RunConclusionEmittedFailed extends S.TaggedClass<RunConclusionEmittedFailed>()(
  'RunConclusionEmittedFailed',
  {
    command: RunOutcomeCommand,
    exitCode: S.Finite,
  },
) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export class RunConclusionQuietOk extends S.TaggedClass<RunConclusionQuietOk>()('RunConclusionQuietOk', {}) {
  readonly [PlanRunConclusionTypeId] = PlanRunConclusionTypeId
}

export class RunConclusionQuietFailed extends S.TaggedClass<RunConclusionQuietFailed>()('RunConclusionQuietFailed', {
  exitCode: S.Finite,
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

const quietOf = (command: PlanRunConclusionCommand): PlanRunConclusionDecision =>
  Boolean.match(command.exitCode === 0, {
    onTrue: () => RunConclusionQuietOk.make({}),
    onFalse: () => RunConclusionQuietFailed.make({ exitCode: command.exitCode }),
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
