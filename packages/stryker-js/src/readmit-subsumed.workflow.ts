import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ReadmitSubsumedTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ReadmitSubsumed')
type ReadmitSubsumedTypeId = typeof ReadmitSubsumedTypeId

export class Settled extends S.TaggedClass<Settled>()('Settled', {
  status: S.Literals(['Killed', 'Survived', 'Timeout', 'NoCoverage', 'RuntimeError']),
}) {}

export class IgnoredAtCheck extends S.TaggedClass<IgnoredAtCheck>()('IgnoredAtCheck', {
  reason: S.String,
}) {}

export class CompiledWithError extends S.TaggedClass<CompiledWithError>()('CompiledWithError', {}) {}

export class IgnoredAtPlan extends S.TaggedClass<IgnoredAtPlan>()('IgnoredAtPlan', {}) {}

export class Remembered extends S.TaggedClass<Remembered>()('Remembered', {
  status: Mutant.MutantStatusSchema,
}) {}

export class Unsettled extends S.TaggedClass<Unsettled>()('Unsettled', {}) {}

export const DominatorOutcome = S.Union([Settled, IgnoredAtCheck, CompiledWithError, IgnoredAtPlan, Remembered])
export type DominatorOutcome = typeof DominatorOutcome.Type

export const ReadmitCauseOutcome = S.Union([DominatorOutcome, Unsettled])
export type ReadmitCauseOutcome = typeof ReadmitCauseOutcome.Type

export const ReadmitCause = S.Struct({
  dominator: Mutant.MutantId,
  outcome: ReadmitCauseOutcome,
})
export type ReadmitCause = typeof ReadmitCause.Type

export const HeldMutant = S.Struct({
  id: Mutant.MutantId,
  dominators: S.NonEmptyArray(Mutant.MutantId),
})
export type HeldMutant = typeof HeldMutant.Type

export const DominatorSettlement = S.Struct({
  id: Mutant.MutantId,
  outcome: DominatorOutcome,
})
export type DominatorSettlement = typeof DominatorSettlement.Type

export class ReadmitSubsumedCommand extends S.TaggedClass<ReadmitSubsumedCommand>()('ReadmitSubsumedCommand', {
  held: S.Array(HeldMutant),
  settlements: S.Array(DominatorSettlement),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class StillSubsumed extends S.TaggedClass<StillSubsumed>()('StillSubsumed', {
  id: Mutant.MutantId,
  dominator: Mutant.MutantId,
}) {
  readonly [ReadmitSubsumedTypeId] = ReadmitSubsumedTypeId
}

export class Readmitted extends S.TaggedClass<Readmitted>()('Readmitted', {
  id: Mutant.MutantId,
  causes: S.NonEmptyArray(ReadmitCause),
}) {
  readonly [ReadmitSubsumedTypeId] = ReadmitSubsumedTypeId
}

export const SubsumptionRuling = S.Union([StillSubsumed, Readmitted])
export type SubsumptionRuling = typeof SubsumptionRuling.Type

export const SubsumptionRulings = S.Array(SubsumptionRuling)
export type SubsumptionRulings = typeof SubsumptionRulings.Type

const RUNNING_STATUSES: ReadonlyArray<Mutant.MutantStatus> = [
  'Killed',
  'Survived',
  'Timeout',
  'NoCoverage',
  'RuntimeError',
]

const runsWithStatus = (status: Mutant.MutantStatus): boolean => Arr.contains(RUNNING_STATUSES, status)

const dominatorRuns = (outcome: DominatorOutcome): boolean =>
  Match.value(outcome).pipe(
    Match.tag('Settled', () => true),
    Match.tag('Remembered', (remembered) => runsWithStatus(remembered.status)),
    Match.tag('IgnoredAtCheck', () => false),
    Match.tag('IgnoredAtPlan', () => false),
    Match.tag('CompiledWithError', () => false),
    Match.exhaustive,
  )

const settlementRuns = (settlements: ReadonlyArray<DominatorSettlement>, id: Mutant.MutantId): boolean =>
  Option.match(Arr.findFirst(settlements, (settlement) => settlement.id === id), {
    onNone: () => false,
    onSome: (settlement) => dominatorRuns(settlement.outcome),
  })

const causeOutcomeOf = (
  settlements: ReadonlyArray<DominatorSettlement>,
  dominator: Mutant.MutantId,
): ReadmitCauseOutcome =>
  Option.match(Arr.findFirst(settlements, (settlement) => settlement.id === dominator), {
    onNone: () => Unsettled.make({}),
    onSome: (settlement) => settlement.outcome,
  })

const causesOf = (command: ReadmitSubsumedCommand, held: HeldMutant): Arr.NonEmptyReadonlyArray<ReadmitCause> =>
  Arr.map(
    held.dominators,
    (dominator) => ReadmitCause.make({ dominator, outcome: causeOutcomeOf(command.settlements, dominator) }),
  )

const rulingOf = (command: ReadmitSubsumedCommand, held: HeldMutant): SubsumptionRuling =>
  Option.match(Arr.findFirst(held.dominators, (dominator) => settlementRuns(command.settlements, dominator)), {
    onNone: () => Readmitted.make({ id: held.id, causes: causesOf(command, held) }),
    onSome: (dominator) => StillSubsumed.make({ id: held.id, dominator }),
  })

const rulingsOf = (command: ReadmitSubsumedCommand): ReadonlyArray<SubsumptionRuling> =>
  Arr.map(command.held, (held) => rulingOf(command, held))

export const readmitSubsumed = Workflow.make({
  command: ReadmitSubsumedCommand,
  decision: SubsumptionRulings,
  error: S.Never,
  decide: (command: ReadmitSubsumedCommand): Result.Result<ReadonlyArray<SubsumptionRuling>, never> =>
    Result.succeed(rulingsOf(command)),
})
