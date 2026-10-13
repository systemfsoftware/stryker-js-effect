import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const MutantRunOutcomeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantRunOutcome')
type MutantRunOutcomeTypeId = typeof MutantRunOutcomeTypeId

export const NoCoveringTestExecutedReason = S.Literal('no covering test executed')

export const NeverStartedReason = S.Literal('a fresh test runner did not start the mutant run within its boot window')

const CONFIRMATION_DEADLINE_FACTOR = 2

export class MutantRunSettled extends S.TaggedClass<MutantRunSettled>()('MutantRunSettled', {}) {
  readonly [MutantRunOutcomeTypeId] = MutantRunOutcomeTypeId
}

export class MutantRunConfirm extends S.TaggedClass<MutantRunConfirm>()('MutantRunConfirm', {
  timeoutMs: Mutant.RunOptionsFields.timeout,
}) {
  readonly [MutantRunOutcomeTypeId] = MutantRunOutcomeTypeId
}

export class MutantRunTimeoutConfirmed
  extends S.TaggedClass<MutantRunTimeoutConfirmed>()('MutantRunTimeoutConfirmed', {})
{
  readonly [MutantRunOutcomeTypeId] = MutantRunOutcomeTypeId
}

export class MutantRunNeverStarted extends S.TaggedClass<MutantRunNeverStarted>()('MutantRunNeverStarted', {}) {
  readonly [MutantRunOutcomeTypeId] = MutantRunOutcomeTypeId
}

export class MutantRunRetry extends S.TaggedClass<MutantRunRetry>()('MutantRunRetry', {}) {
  readonly [MutantRunOutcomeTypeId] = MutantRunOutcomeTypeId
}

export class MutantRunRetryExhausted extends S.TaggedClass<MutantRunRetryExhausted>()('MutantRunRetryExhausted', {}) {
  readonly [MutantRunOutcomeTypeId] = MutantRunOutcomeTypeId
}

export type MutantRunOutcome =
  | MutantRunSettled
  | MutantRunConfirm
  | MutantRunTimeoutConfirmed
  | MutantRunNeverStarted
  | MutantRunRetry
  | MutantRunRetryExhausted

export class MutantRunObservation extends S.Class<MutantRunObservation>('MutantRunObservation')({
  workerReplaced: S.Boolean,
  neverStarted: S.Boolean,
  confirming: S.Boolean,
  timeoutMs: Mutant.RunOptionsFields.timeout,
  coveringTests: S.String.pipe(S.Array),
  executedTests: S.String.pipe(S.Array, S.optionalKey),
  attempt: S.Natural,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const intersects = (covering: readonly string[], executed: readonly string[]): boolean =>
  covering.some((id) => executed.includes(id))

const coveringTestMissing = (command: MutantRunObservation): boolean =>
  Boolean.match(command.coveringTests.length > 0, {
    onTrue: () =>
      Option.match(Option.fromUndefinedOr(command.executedTests), {
        onNone: () => false,
        onSome: (executed) => !intersects(command.coveringTests, executed),
      }),
    onFalse: () => false,
  })

const decideRetry = (command: MutantRunObservation): Result.Result<MutantRunOutcome, never> =>
  Boolean.match(command.attempt === 0, {
    onTrue: () => Result.succeed(MutantRunRetry.make({})),
    onFalse: () => Result.succeed(MutantRunRetryExhausted.make({})),
  })

const decideGuard = (command: MutantRunObservation): Result.Result<MutantRunOutcome, never> =>
  Boolean.match(coveringTestMissing(command), {
    onTrue: () => decideRetry(command),
    onFalse: () => Result.succeed(MutantRunSettled.make({})),
  })

const confirmationDeadlineOf = (timeoutMs: number): number =>
  Boolean.match(Number.isFinite(timeoutMs * CONFIRMATION_DEADLINE_FACTOR), {
    onTrue: () => timeoutMs * CONFIRMATION_DEADLINE_FACTOR,
    onFalse: () => Number.MAX_VALUE,
  })

const decideConfirmation = (command: MutantRunObservation): Result.Result<MutantRunOutcome, never> =>
  Boolean.match(command.neverStarted, {
    onTrue: () => Result.succeed(MutantRunNeverStarted.make({})),
    onFalse: () => Result.succeed(MutantRunTimeoutConfirmed.make({})),
  })

const decideExpiry = (command: MutantRunObservation): Result.Result<MutantRunOutcome, never> =>
  Boolean.match(command.confirming, {
    onTrue: () => decideConfirmation(command),
    onFalse: () => Result.succeed(MutantRunConfirm.make({ timeoutMs: confirmationDeadlineOf(command.timeoutMs) })),
  })

const decide = (command: MutantRunObservation): Result.Result<MutantRunOutcome, never> =>
  Boolean.match(command.workerReplaced, {
    onTrue: () => decideExpiry(command),
    onFalse: () => decideGuard(command),
  })

export const interpretMutantRun = Workflow.make({
  command: MutantRunObservation,
  decision: S.Union([
    MutantRunSettled,
    MutantRunConfirm,
    MutantRunTimeoutConfirmed,
    MutantRunNeverStarted,
    MutantRunRetry,
    MutantRunRetryExhausted,
  ]),
  error: S.Never,
  decide,
})
