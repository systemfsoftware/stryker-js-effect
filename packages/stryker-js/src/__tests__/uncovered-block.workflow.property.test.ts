import { describe, it } from '@systemfsoftware/vitest'

import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  BlockSettlement,
  BlockUncovered,
  GuardKept,
  HeldGuard,
  uncoveredBlock,
  UncoveredBlockCommand,
} from '../uncovered-block.workflow.js'

const NO_COVERAGE: Mutant.MutantStatus = 'NoCoverage'

const membersOf = (guard: Mutant.Guard): ReadonlyArray<Mutant.MutantId> => [guard.block, ...guard.inside]

const allMembersOf = (command: UncoveredBlockCommand): ReadonlyArray<Mutant.MutantId> =>
  Arr.flatMap(command.held, (held) => membersOf(held.guard))

const isMemberOf = (command: UncoveredBlockCommand, id: Mutant.MutantId): boolean =>
  Arr.contains(allMembersOf(command), id)

const heldOf = (command: UncoveredBlockCommand, id: Mutant.MutantId): Option.Option<HeldGuard> =>
  Arr.findFirst(command.held, (held) => held.id === id)

const expectedWitnessOf = (
  command: UncoveredBlockCommand,
  guard: Mutant.Guard,
): Option.Option<Mutant.MutantId> =>
  Arr.findFirst(
    membersOf(guard),
    (member) =>
      Arr.some(command.settlements, (settlement) => settlement.id === member && settlement.status === NO_COVERAGE),
  )

const rulingKeyOf = (ruling: BlockUncovered | GuardKept): string =>
  S.is(BlockUncovered)(ruling) ? `uncovered:${ruling.id}:${ruling.noCoverage}` : `kept:${ruling.id}`

const expectedKeyOf = (command: UncoveredBlockCommand, held: HeldGuard): string =>
  Option.match(expectedWitnessOf(command, held.guard), {
    onNone: () => `kept:${held.id}`,
    onSome: (witness) => `uncovered:${held.id}:${witness}`,
  })

const statusAt = (statuses: ReadonlyArray<Mutant.MutantStatus>, index: number): Mutant.MutantStatus =>
  Option.getOrThrow(Arr.get(statuses, index % statuses.length))

const witnessed = (
  command: UncoveredBlockCommand,
  statuses: ReadonlyArray<Mutant.MutantStatus>,
): UncoveredBlockCommand =>
  UncoveredBlockCommand.make({
    _tag: 'UncoveredBlockCommand',
    held: [...command.held],
    settlements: [
      ...command.settlements,
      ...Arr.map(
        Arr.dedupe(allMembersOf(command)),
        (id, index) => BlockSettlement.make({ id, status: statusAt(statuses, index) }),
      ),
    ],
  })

const withoutNonMembers = (command: UncoveredBlockCommand): UncoveredBlockCommand =>
  UncoveredBlockCommand.make({
    _tag: 'UncoveredBlockCommand',
    held: [...command.held],
    settlements: Arr.filter(command.settlements, (settlement) => isMemberOf(command, settlement.id)),
  })

const rulingsAsDefined = (subject: typeof uncoveredBlock, command: UncoveredBlockCommand): boolean =>
  Result.match(subject(command), {
    onFailure: () => false,
    onSuccess: (rulings) =>
      rulings.length === command.held.length &&
      Arr.every(rulings, (ruling, index) =>
        Option.match(Option.fromUndefinedOr(command.held[index]), {
          onNone: () => false,
          onSome: (held) => rulingKeyOf(ruling) === expectedKeyOf(command, held),
        })),
  })

const suppressedRulingsNameAMemberWitness = (subject: typeof uncoveredBlock, command: UncoveredBlockCommand): boolean =>
  Result.match(subject(command), {
    onFailure: () => false,
    onSuccess: (rulings) =>
      Arr.every(rulings, (ruling) =>
        S.is(BlockUncovered)(ruling)
          ? Option.match(heldOf(command, ruling.id), {
            onNone: () => false,
            onSome: (held) =>
              Arr.contains(membersOf(held.guard), ruling.noCoverage) &&
              Arr.some(
                command.settlements,
                (settlement) => settlement.id === ruling.noCoverage && settlement.status === NO_COVERAGE,
              ),
          })
          : true),
  })

const keptRulingsHaveNoMemberWitness = (subject: typeof uncoveredBlock, command: UncoveredBlockCommand): boolean =>
  Result.match(subject(command), {
    onFailure: () => false,
    onSuccess: (rulings) =>
      Arr.every(rulings, (ruling) =>
        S.is(GuardKept)(ruling)
          ? Option.match(heldOf(command, ruling.id), {
            onNone: () => false,
            onSome: (held) => Option.isNone(expectedWitnessOf(command, held.guard)),
          })
          : true),
  })

const rulingsFollowHeldOrder = (subject: typeof uncoveredBlock, command: UncoveredBlockCommand): boolean =>
  Result.match(subject(command), {
    onFailure: () => false,
    onSuccess: (rulings) =>
      rulings.length === command.held.length &&
      Arr.every(rulings, (ruling, index) =>
        Option.match(Option.fromUndefinedOr(command.held[index]), {
          onNone: () => false,
          onSome: (held) => ruling.id === held.id,
        })),
  })

const removingNonMembersChangesNothing = (subject: typeof uncoveredBlock, command: UncoveredBlockCommand): boolean =>
  Result.match(subject(command), {
    onFailure: () => false,
    onSuccess: (rulings) =>
      Result.match(subject(withoutNonMembers(command)), {
        onFailure: () => false,
        onSuccess: (trimmed) =>
          trimmed.length === rulings.length &&
          Arr.every(trimmed, (ruling, index) =>
            Option.match(Option.fromUndefinedOr(rulings[index]), {
              onNone: () => false,
              onSome: (original) => rulingKeyOf(ruling) === rulingKeyOf(original),
            })),
      }),
  })

const holdsFor = (
  check: (subject: typeof uncoveredBlock, command: UncoveredBlockCommand) => boolean,
  subject: typeof uncoveredBlock,
  command: UncoveredBlockCommand,
  statuses: ReadonlyArray<Mutant.MutantStatus>,
): boolean =>
  Arr.every(
    [command, witnessed(command, statuses)],
    (input) => rulingsAsDefined(subject, input) && check(subject, input),
  )

describe('uncoveredBlock', () => {
  it.prop(
    '∀c_BlockUncoveredRuling_≡ItsWitnessIsAMemberOfItsGuardWithANoCoverageSettlement',
    { of: [UncoveredBlockCommand, S.NonEmptyArray(Mutant.MutantStatusSchema)], subject: uncoveredBlock },
    (subject, [command, statuses]) => holdsFor(suppressedRulingsNameAMemberWitness, subject, command, statuses),
  )

  it.prop(
    '∀c_GuardKeptRuling_≡NoMemberHasANoCoverageSettlement',
    { of: [UncoveredBlockCommand, S.NonEmptyArray(Mutant.MutantStatusSchema)], subject: uncoveredBlock },
    (subject, [command, statuses]) => holdsFor(keptRulingsHaveNoMemberWitness, subject, command, statuses),
  )

  it.prop(
    '∀c_UncoveredBlockRulings_≡OnePerHeldIdInHeldOrder',
    { of: [UncoveredBlockCommand, S.NonEmptyArray(Mutant.MutantStatusSchema)], subject: uncoveredBlock },
    (subject, [command, statuses]) => holdsFor(rulingsFollowHeldOrder, subject, command, statuses),
  )

  it.prop(
    '∀c_NonMemberSettlement_≡NeverSuppressesAGuard',
    { of: [UncoveredBlockCommand, S.NonEmptyArray(Mutant.MutantStatusSchema)], subject: uncoveredBlock },
    (subject, [command, statuses]) => holdsFor(removingNonMembersChangesNothing, subject, command, statuses),
  )
})
