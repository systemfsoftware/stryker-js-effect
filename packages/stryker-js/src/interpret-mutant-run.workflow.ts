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

export type MutantRunOutcome = MutantRunSettled | MutantRunPoolInvalidated

export class MutantRunObservation extends S.Class<MutantRunObservation>('MutantRunObservation')({
  wallClockTimeout: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decide = (command: MutantRunObservation): Result.Result<MutantRunOutcome, never> =>
  Boolean.match(command.wallClockTimeout, {
    onTrue: () => Result.succeed(MutantRunPoolInvalidated.make({})),
    onFalse: () => Result.succeed(MutantRunSettled.make({})),
  })

export const interpretMutantRun = Workflow.make({
  command: MutantRunObservation,
  decision: S.Union([MutantRunSettled, MutantRunPoolInvalidated]),
  error: S.Never,
  decide,
})
