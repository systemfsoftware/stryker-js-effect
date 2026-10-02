import { Workflow } from '@systemfsoftware/effect-cell-types'
import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as Runtime from 'effect/Runtime'
import * as S from 'effect/Schema'

import {
  type ObservedFailure,
  type RunFailedObservation,
  RunOutcomeCommand,
  type RunSucceededVerdict,
} from './RunOutcomeCommand.schema.js'

export class RunExit extends S.TaggedError<RunExit>()('RunExit', { code: Plugin.ExitCode }) {
  override get [Runtime.errorExitCode](): number {
    return this.code
  }

  override get message(): string {
    return `Run exited with code ${this.code}`
  }
}

const RunOutcomeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/RunOutcome')
type RunOutcomeTypeId = typeof RunOutcomeTypeId

export class RunOk extends S.TaggedClass<RunOk>()('RunOk', {
  help: S.Boolean,
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunVerdictFailed extends S.TaggedClass<RunVerdictFailed>()('RunVerdictFailed', {
  code: Plugin.ExitCode,
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunFailed extends S.TaggedClass<RunFailed>()('RunFailed', {
  code: Plugin.ExitCode,
  record: FailureRecord.FailureRecord,
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export const RunOutcomeDecision = S.Union([RunOk, RunVerdictFailed, RunFailed])
export type RunOutcomeDecision = typeof RunOutcomeDecision.Type

const verdictCode = (exitClass: Plugin.ExitClass): Plugin.ExitCode =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => 1),
    Match.when('ConfigError', () => 2),
    Match.when('RuntimeError', () => 3),
    Match.when('InternalError', () => 4),
    Match.exhaustive,
  )

const PRECEDENCE_LOW_TO_HIGH: ReadonlyArray<number> = [130, 1, 2, 5, 3, 4]

const bySeverity: Order.Order<ObservedFailure> = Order.mapInput(
  Order.Number,
  (failure: ObservedFailure) => PRECEDENCE_LOW_TO_HIGH.indexOf(failure.exitCode),
)

const decidingFailureOf = (observation: RunFailedObservation): ObservedFailure =>
  Arr.headNonEmpty(Arr.sort(observation.failures, Order.flip(bySeverity)))

const failedOutcome = (observation: RunFailedObservation): RunOutcomeDecision => {
  const deciding = decidingFailureOf(observation)
  return RunFailed.make({ code: deciding.exitCode, record: deciding.record })
}

const verdictOutcome = (observation: RunSucceededVerdict): RunOutcomeDecision =>
  RunVerdictFailed.make({ code: verdictCode(observation.exitClass) })

const decide = (command: RunOutcomeCommand): Result.Result<RunOutcomeDecision, never> =>
  Result.succeed(
    Match.value(command.observation).pipe(
      Match.tag('RunSucceededClean', () => RunOk.make({ help: false })),
      Match.tag('RunHelpObservation', () => RunOk.make({ help: true })),
      Match.tag('RunSucceededVerdict', verdictOutcome),
      Match.tag('RunFailedObservation', failedOutcome),
      Match.exhaustive,
    ),
  )

export const classifyRunOutcome = Workflow.make({
  command: RunOutcomeCommand,
  decision: RunOutcomeDecision,
  error: S.Never,
  decide,
})
