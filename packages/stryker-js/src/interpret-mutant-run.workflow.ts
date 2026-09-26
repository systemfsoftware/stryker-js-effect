import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const MutantRunOutcomeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantRunOutcome')
type MutantRunOutcomeTypeId = typeof MutantRunOutcomeTypeId

export class MutantRunSettled extends S.TaggedClass<MutantRunSettled>()('MutantRunSettled', {}) {
  readonly [MutantRunOutcomeTypeId] = MutantRunOutcomeTypeId
}

export class MutantRunPoolInvalidated
  extends S.TaggedClass<MutantRunPoolInvalidated>()('MutantRunPoolInvalidated', {})
{
  readonly [MutantRunOutcomeTypeId] = MutantRunOutcomeTypeId
}

export class MutantRunWallClockStopped extends S.TaggedClass<MutantRunWallClockStopped>()(
  'MutantRunWallClockStopped',
  {},
) {
  readonly [MutantRunOutcomeTypeId] = MutantRunOutcomeTypeId
}

export type MutantRunOutcome = MutantRunSettled | MutantRunPoolInvalidated | MutantRunWallClockStopped

export class MutantRunObservation extends S.Class<MutantRunObservation>('MutantRunObservation')({
  status: S.String,
  timedOut: S.Boolean,
  wallClockTimeout: S.Boolean,
  hitLimitReason: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decide = (command: MutantRunObservation): Result.Result<MutantRunOutcome, never> =>
  Boolean.match(command.wallClockTimeout, {
    onTrue: () => Result.succeed(MutantRunPoolInvalidated.make({})),
    onFalse: () =>
      Boolean.match(Boolean.and(command.timedOut, Boolean.not(command.hitLimitReason)), {
        onTrue: () => Result.succeed(MutantRunWallClockStopped.make({})),
        onFalse: () => Result.succeed(MutantRunSettled.make({})),
      }),
  })

export const interpretMutantRun = Workflow.make({
  command: MutantRunObservation,
  decision: S.Union([MutantRunSettled, MutantRunPoolInvalidated, MutantRunWallClockStopped]),
  error: S.Never,
  decide,
})
