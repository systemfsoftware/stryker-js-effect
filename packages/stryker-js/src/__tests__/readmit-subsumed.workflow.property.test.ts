import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  DominatorOutcome,
  DominatorSettlement,
  type HeldMutant,
  IgnoredAtCheck,
  type ReadmitCause,
  type ReadmitCauseOutcome,
  readmitSubsumed,
  ReadmitSubsumedCommand,
  Readmitted,
  Remembered,
  Settled,
  StillSubsumed,
  type SubsumptionRuling,
  Unsettled,
} from '../readmit-subsumed.workflow.js'

type Subject = typeof readmitSubsumed

const NON_RUNNING_STATUSES: ReadonlyArray<Mutant.MutantStatus> = ['CompileError', 'Ignored', 'Pending']

type AnyOutcome = DominatorOutcome | ReadmitCauseOutcome

const statusOf = (outcome: AnyOutcome): Option.Option<Mutant.MutantStatus> =>
  S.is(Settled)(outcome) || S.is(Remembered)(outcome) ? Option.some(outcome.status) : Option.none()

const outcomeRuns = (outcome: AnyOutcome): boolean =>
  Option.match(statusOf(outcome), {
    onNone: () => false,
    onSome: (status) => !Arr.contains(NON_RUNNING_STATUSES, status),
  })

const settlementOutcomeOf = (command: ReadmitSubsumedCommand, id: Mutant.MutantId): Option.Option<DominatorOutcome> =>
  Option.map(
    Arr.findFirst(command.settlements, (settlement) => settlement.id === id),
    (settlement) => settlement.outcome,
  )

const dominatorRuns = (command: ReadmitSubsumedCommand, dominator: Mutant.MutantId): boolean =>
  Option.match(settlementOutcomeOf(command, dominator), { onNone: () => false, onSome: outcomeRuns })

const expectedCauseOutcome = (command: ReadmitSubsumedCommand, dominator: Mutant.MutantId): AnyOutcome =>
  Option.getOrElse(settlementOutcomeOf(command, dominator), () => Unsettled.make({}))

const firstRunningOf = (command: ReadmitSubsumedCommand, held: HeldMutant): Option.Option<Mutant.MutantId> =>
  Arr.findFirst(held.dominators, (dominator) => dominatorRuns(command, dominator))

const ruledAsDefined = (command: ReadmitSubsumedCommand, held: HeldMutant, ruling: SubsumptionRuling): boolean =>
  Option.match(firstRunningOf(command, held), {
    onNone: () => S.is(Readmitted)(ruling) && ruling.id === held.id,
    onSome: (dominator) => S.is(StillSubsumed)(ruling) && ruling.id === held.id && ruling.dominator === dominator,
  })

const holdsOver = (subject: Subject, command: ReadmitSubsumedCommand): boolean =>
  Result.match(subject(command), {
    onFailure: () => false,
    onSuccess: (rulings) =>
      rulings.length === command.held.length &&
      Arr.every(rulings, (ruling, index) =>
        Option.match(Option.fromUndefinedOr(command.held[index]), {
          onNone: () => false,
          onSome: (held) => ruledAsDefined(command, held, ruling),
        })),
  })

const namesARunningNamedDominator = (subject: Subject, command: ReadmitSubsumedCommand): boolean =>
  Result.match(subject(command), {
    onFailure: () => false,
    onSuccess: (rulings) =>
      Arr.every(rulings, (ruling) =>
        S.is(StillSubsumed)(ruling)
          ? Arr.some(
            command.held,
            (held) =>
              held.id === ruling.id &&
              Arr.contains(held.dominators, ruling.dominator) &&
              dominatorRuns(command, ruling.dominator),
          )
          : true),
  })

const outcomeTagOf = (outcome: AnyOutcome): string =>
  S.is(Settled)(outcome) || S.is(Remembered)(outcome) ? `${outcome._tag}:${outcome.status}` : outcome._tag

const outcomeKeyOf = (outcome: AnyOutcome): string =>
  S.is(IgnoredAtCheck)(outcome) ? `${outcome._tag}:${outcome.reason}` : outcomeTagOf(outcome)

const causeKeyOf = (cause: ReadmitCause): string => `${cause.dominator}=${outcomeKeyOf(cause.outcome)}`

const expectedCauseKeyOf = (command: ReadmitSubsumedCommand, dominator: Mutant.MutantId): string =>
  `${dominator}=${outcomeKeyOf(expectedCauseOutcome(command, dominator))}`

const causeTagsOf = (causes: ReadonlyArray<ReadmitCause>): ReadonlyArray<string> =>
  Arr.map(causes, (cause) => `${cause.dominator}=${outcomeTagOf(cause.outcome)}`)

const rulingKeyOf = (ruling: SubsumptionRuling): string =>
  S.is(StillSubsumed)(ruling)
    ? `still:${ruling.id}:${ruling.dominator}`
    : `readmitted:${ruling.id}:${Arr.join(causeTagsOf(ruling.causes), ',')}`

const sameRulings = (left: ReadonlyArray<SubsumptionRuling>, right: ReadonlyArray<SubsumptionRuling>): boolean =>
  left.length === right.length &&
  Arr.every(left, (ruling, index) =>
    Option.match(Option.fromUndefinedOr(right[index]), {
      onNone: () => false,
      onSome: (other) => rulingKeyOf(ruling) === rulingKeyOf(other),
    }))

const causesHold = (command: ReadmitSubsumedCommand, held: HeldMutant, causes: ReadonlyArray<ReadmitCause>): boolean =>
  causes.length === held.dominators.length &&
  Arr.every(causes, (cause, index) =>
    Option.match(Option.fromUndefinedOr(held.dominators[index]), {
      onNone: () => false,
      onSome: (dominator) => causeKeyOf(cause) === expectedCauseKeyOf(command, dominator),
    }))

const causesAsDefined = (subject: Subject, command: ReadmitSubsumedCommand): boolean =>
  Result.match(subject(command), {
    onFailure: () => false,
    onSuccess: (rulings) =>
      Arr.every(rulings, (ruling, index) =>
        S.is(Readmitted)(ruling)
          ? Option.match(Option.fromUndefinedOr(command.held[index]), {
            onNone: () => false,
            onSome: (held) => causesHold(command, held, ruling.causes),
          })
          : true),
  })

const withReasonIn = (settlement: DominatorSettlement, reason: string): DominatorSettlement =>
  S.is(IgnoredAtCheck)(settlement.outcome)
    ? DominatorSettlement.make({ id: settlement.id, outcome: IgnoredAtCheck.make({ reason }) })
    : settlement

const withRewrittenReasons = (command: ReadmitSubsumedCommand, reason: string): ReadmitSubsumedCommand =>
  ReadmitSubsumedCommand.make({
    held: [...command.held],
    settlements: Arr.map(command.settlements, (settlement) => withReasonIn(settlement, reason)),
  })

const holdsAcrossReasonRewrite = (subject: Subject, command: ReadmitSubsumedCommand, reason: string): boolean =>
  Result.match(subject(command), {
    onFailure: () => false,
    onSuccess: (rulings) =>
      Result.match(subject(withRewrittenReasons(command, reason)), {
        onFailure: () => false,
        onSuccess: (rewritten) => sameRulings(rulings, rewritten),
      }),
  })

const dominatorIdsOf = (held: ReadonlyArray<HeldMutant>): ReadonlyArray<Mutant.MutantId> =>
  Arr.flatMap(held, (entry) => [...entry.dominators])

const outcomeAt = (outcomes: ReadonlyArray<DominatorOutcome>, index: number): DominatorOutcome =>
  Option.getOrThrow(Arr.get(outcomes, index % outcomes.length))

const witnessed = (
  command: ReadmitSubsumedCommand,
  outcomes: ReadonlyArray<DominatorOutcome>,
): ReadmitSubsumedCommand =>
  ReadmitSubsumedCommand.make({
    held: [...command.held],
    settlements: [
      ...command.settlements,
      ...Arr.map(
        dominatorIdsOf(command.held),
        (id, index) => DominatorSettlement.make({ id, outcome: outcomeAt(outcomes, index) }),
      ),
    ],
  })

describe('readmitSubsumed', () => {
  it.prop(
    '∀c_ReadmitSubsumedCommand_≡ReadmittedExactlyWhenNoNamedDominatorRuns',
    { of: [ReadmitSubsumedCommand, S.NonEmptyArray(DominatorOutcome)], subject: readmitSubsumed },
    (subject, [command, outcomes]) => holdsOver(subject, command) && holdsOver(subject, witnessed(command, outcomes)),
  )

  it.prop(
    '∀c_StillSubsumed_≡NamesANamedDominatorThatRuns',
    { of: [ReadmitSubsumedCommand, S.NonEmptyArray(DominatorOutcome)], subject: readmitSubsumed },
    (subject, [command, outcomes]) =>
      namesARunningNamedDominator(subject, command) &&
      namesARunningNamedDominator(subject, witnessed(command, outcomes)),
  )

  it.prop(
    '∀c_SettlementReasonsRewritten_≡EveryRulingUnchanged',
    { of: [ReadmitSubsumedCommand, S.NonEmptyArray(DominatorOutcome), S.String], subject: readmitSubsumed },
    (subject, [command, outcomes, reason]) =>
      holdsAcrossReasonRewrite(subject, command, reason) &&
      holdsAcrossReasonRewrite(subject, witnessed(command, outcomes), reason),
  )

  it.prop(
    '∀c_Readmitted_≡CausesListEveryNamedDominatorInOrderWithItsFirstSettlementOutcome',
    { of: [ReadmitSubsumedCommand, S.NonEmptyArray(DominatorOutcome)], subject: readmitSubsumed },
    (subject, [command, outcomes]) =>
      causesAsDefined(subject, command) && causesAsDefined(subject, witnessed(command, outcomes)),
  )
})
