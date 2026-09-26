import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Runtime from 'effect/Runtime'
import * as S from 'effect/Schema'

import {
  RunClassedObservation,
  RunCliErrorObservation,
  RunGenericFailureObservation,
  RunHelpObservation,
  RunOutcomeCommand,
  RunSchemaErrorObservation,
  RunSucceededVerdict,
  RunSurvivorsRejectedObservation,
} from './RunOutcomeCommand.schema.js'

export class RunExit extends S.TaggedError<RunExit>()('RunExit', { code: Plugin.ExitCode }) {
  override get [Runtime.errorExitCode](): number {
    return this.code
  }
}

const CONFIG_CODE = 2

const classCode = (exitClass: Plugin.ExitClass): number =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => 1),
    Match.when('ConfigError', () => CONFIG_CODE),
    Match.when('RuntimeError', () => 3),
    Match.when('InternalError', () => 4),
    Match.exhaustive,
  )

const RunOutcomeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/RunOutcome')
type RunOutcomeTypeId = typeof RunOutcomeTypeId

export class RunOk extends S.TaggedClass<RunOk>()('RunOk', {
  help: S.Boolean,
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunInterrupted extends S.TaggedError<RunInterrupted>()('RunInterrupted', {
  code: Plugin.ExitCode,
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunParseFailed extends S.TaggedClass<RunParseFailed>()('RunParseFailed', {
  unrecognized: S.optional(S.String),
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunSurvivorsRejected extends S.TaggedClass<RunSurvivorsRejected>()('RunSurvivorsRejected', {
  reason: S.Literals(['no-report', 'mismatch']),
  diagnostic: S.optional(S.String),
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunConfigFailed extends S.TaggedClass<RunConfigFailed>()('RunConfigFailed', {
  detail: S.optional(S.String),
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunFailed extends S.TaggedClass<RunFailed>()('RunFailed', {
  code: Plugin.ExitCode,
  diagnostic: S.optional(S.String),
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export type RunOutcomeDecision =
  | RunOk
  | RunParseFailed
  | RunSurvivorsRejected
  | RunConfigFailed
  | RunFailed

export type RunOutcomeError = RunInterrupted

export type FailedRunOutcome = Exclude<RunOutcomeDecision, RunOk> | RunOutcomeError

const succeededCleanOutcome = (): RunOutcomeDecision => RunOk.make({ help: false })

const succeededVerdictOutcome = (observation: RunSucceededVerdict): RunOutcomeDecision =>
  RunFailed.make({
    code: classCode(observation.exitClass),
    diagnostic: Option.getOrUndefined(Option.fromNullishOr(observation.diagnostic)),
  })

const helpOutcome = (observation: RunHelpObservation): RunOutcomeDecision =>
  Boolean.match(observation.errorCount > 0, {
    onTrue: () =>
      RunParseFailed.make({ unrecognized: Option.getOrUndefined(Option.fromNullishOr(observation.unrecognized)) }),
    onFalse: () => RunOk.make({ help: true }),
  })

const cliErrorOutcome = (observation: RunCliErrorObservation): RunOutcomeDecision =>
  RunParseFailed.make({ unrecognized: Option.getOrUndefined(Option.fromNullishOr(observation.unrecognized)) })

const survivorsRejectedOutcome = (observation: RunSurvivorsRejectedObservation): RunOutcomeDecision =>
  RunSurvivorsRejected.make({
    reason: observation.reason,
    diagnostic: Option.getOrUndefined(Option.fromNullishOr(observation.diagnostic)),
  })

const schemaErrorOutcome = (observation: RunSchemaErrorObservation): RunOutcomeDecision =>
  RunConfigFailed.make({ detail: Option.getOrUndefined(Option.fromNullishOr(observation.configDetail)) })

const classedOutcome = (observation: RunClassedObservation): RunOutcomeDecision =>
  Match.value(observation.exitClass).pipe(
    Match.when(
      'ConfigError',
      () => RunConfigFailed.make({ detail: Option.getOrUndefined(Option.fromNullishOr(observation.configDetail)) }),
    ),
    Match.orElse((exitClass) =>
      RunFailed.make({
        code: classCode(exitClass),
        diagnostic: Option.getOrUndefined(Option.fromNullishOr(observation.diagnostic)),
      })
    ),
  )

const genericFailureOutcome = (observation: RunGenericFailureObservation): RunOutcomeDecision =>
  RunFailed.make({ code: 1, diagnostic: Option.getOrUndefined(Option.fromNullishOr(observation.diagnostic)) })

const decide = (command: RunOutcomeCommand): Result.Result<RunOutcomeDecision, RunOutcomeError> =>
  Match.value(command.observation).pipe(
    Match.tag('RunSucceededClean', () => Result.succeed(succeededCleanOutcome())),
    Match.tag('RunSucceededVerdict', (observation) => Result.succeed(succeededVerdictOutcome(observation))),
    Match.tag('RunInterruptedObservation', () => Result.fail(RunInterrupted.make({ code: 130 }))),
    Match.tag('RunHelpObservation', (observation) => Result.succeed(helpOutcome(observation))),
    Match.tag('RunCliErrorObservation', (observation) => Result.succeed(cliErrorOutcome(observation))),
    Match.tag(
      'RunSurvivorsRejectedObservation',
      (observation) => Result.succeed(survivorsRejectedOutcome(observation)),
    ),
    Match.tag('RunSchemaErrorObservation', (observation) => Result.succeed(schemaErrorOutcome(observation))),
    Match.tag('RunClassedObservation', (observation) => Result.succeed(classedOutcome(observation))),
    Match.tag('RunGenericFailureObservation', (observation) => Result.succeed(genericFailureOutcome(observation))),
    Match.exhaustive,
  )

export const classifyRunOutcome = Workflow.make({
  command: RunOutcomeCommand,
  decision: S.Union([RunOk, RunParseFailed, RunSurvivorsRejected, RunConfigFailed, RunFailed]),
  error: RunInterrupted,
  decide,
})
