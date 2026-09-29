import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const MutantRunOutcomeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantRunOutcome')
type MutantRunOutcomeTypeId = typeof MutantRunOutcomeTypeId

export const NoCoveringTestExecutedReason = S.Literal('no covering test executed')

export class MutantRunSettled extends S.TaggedClass<MutantRunSettled>()('MutantRunSettled', {}) {
  readonly [MutantRunOutcomeTypeId] = MutantRunOutcomeTypeId
}

export class MutantRunPoolInvalidated
  extends S.TaggedClass<MutantRunPoolInvalidated>()('MutantRunPoolInvalidated', {})
{
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
  | MutantRunPoolInvalidated
  | MutantRunRetry
  | MutantRunRetryExhausted

export class MutantRunObservation extends S.Class<MutantRunObservation>('MutantRunObservation')({
  wallClockTimeout: S.Boolean,
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

const decide = (command: MutantRunObservation): Result.Result<MutantRunOutcome, never> =>
  Boolean.match(command.wallClockTimeout, {
    onTrue: () => Result.succeed(MutantRunPoolInvalidated.make({})),
    onFalse: () => decideGuard(command),
  })

export const interpretMutantRun = Workflow.make({
  command: MutantRunObservation,
  decision: S.Union([MutantRunSettled, MutantRunPoolInvalidated, MutantRunRetry, MutantRunRetryExhausted]),
  error: S.Never,
  decide,
})
