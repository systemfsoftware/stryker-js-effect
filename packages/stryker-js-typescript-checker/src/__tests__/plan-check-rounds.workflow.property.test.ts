import { describe } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlanCheckRoundsCommand, type RoundCandidate } from '../CheckerCommands.schema.js'
import { type CheckRound, planCheckRounds, SharedRound, SoloRound } from '../plan-check-rounds.workflow.js'

const FILE_POOL_SIZE = 3

const PLAN_CHECK_ROUNDS_COMMAND = Arbitrary.map(
  Arbitrary.schema(PlanCheckRoundsCommand),
  (command) => {
    const pool = Arr.take(
      Arr.fromIterable(new Set(Arr.map(command.candidates, (candidate) => candidate.fileName))),
      FILE_POOL_SIZE,
    )
    return PlanCheckRoundsCommand.make({
      candidates: Arr.map(command.candidates, (candidate, index) => ({
        ...candidate,
        fileName: Option.getOrElse(Arr.get(pool, index % pool.length), () => candidate.fileName),
      })),
    })
  },
)

const roundsOf = (command: PlanCheckRoundsCommand): ReadonlyArray<CheckRound> =>
  Result.match(planCheckRounds(command), { onFailure: () => [], onSuccess: (decision) => decision })

const idsOfRound = (round: CheckRound): ReadonlyArray<string> => S.is(SoloRound)(round) ? [round.id] : round.ids

const candidateOf = (command: PlanCheckRoundsCommand, id: string): RoundCandidate | undefined =>
  command.candidates.find((candidate) => candidate.id === id)

const ineligibleIdsOf = (command: PlanCheckRoundsCommand): ReadonlyArray<string> =>
  Arr.map(
    Arr.filter(command.candidates, (candidate) => !candidate.eligible),
    (candidate) => candidate.id,
  )

const fileNamesInOrder = (command: PlanCheckRoundsCommand): ReadonlyArray<string> =>
  Arr.fromIterable(new Set(Arr.map(command.candidates, (candidate) => candidate.fileName)))

const eligibleIdsOfFile = (command: PlanCheckRoundsCommand, fileName: string): ReadonlyArray<string> =>
  Arr.map(
    Arr.filter(command.candidates, (candidate) => candidate.eligible && candidate.fileName === fileName),
    (candidate) => candidate.id,
  )

const observedIdsOfFile = (
  rounds: ReadonlyArray<CheckRound>,
  command: PlanCheckRoundsCommand,
  fileName: string,
): ReadonlyArray<string> =>
  Arr.flatMap(rounds, (round) => Arr.filter(idsOfRound(round), (id) => candidateOf(command, id)?.fileName === fileName))

const partitioned = (rounds: ReadonlyArray<CheckRound>, command: PlanCheckRoundsCommand): boolean =>
  Equal.equals(
    Arr.sort(Arr.flatten(Arr.map(rounds, idsOfRound)), Order.String),
    Arr.sort(Arr.map(command.candidates, (candidate) => candidate.id), Order.String),
  )

const ineligibleLead = (rounds: ReadonlyArray<CheckRound>, command: PlanCheckRoundsCommand): boolean => {
  const ineligible = ineligibleIdsOf(command)
  const prefix = Arr.take(rounds, ineligible.length)
  const prefixIsSoloInOrder = prefix.length === ineligible.length &&
    Arr.every(
      prefix,
      (round, index) => S.is(SoloRound)(round) && round.id === ineligible[index],
    )
  const remainder = Arr.drop(rounds, ineligible.length)
  const remainderHoldsNoIneligible = Arr.every(
    remainder,
    (round) => Arr.every(idsOfRound(round), (id) => !ineligible.includes(id)),
  )
  return prefixIsSoloInOrder && remainderHoldsNoIneligible
}

const sharedRoundsHoldEligibleDistinctFiles = (
  rounds: ReadonlyArray<CheckRound>,
  command: PlanCheckRoundsCommand,
): boolean =>
  Arr.every(rounds, (round) => {
    if (!S.is(SharedRound)(round)) return true
    const fileNames = new Set(Arr.map(round.ids, (id) => candidateOf(command, id)?.fileName))
    const allEligible = Arr.every(round.ids, (id) => candidateOf(command, id)?.eligible === true)
    return round.ids.length >= 2 && fileNames.size === round.ids.length && allEligible
  })

const eligibleRoundCountMatchesDeepestFile = (
  rounds: ReadonlyArray<CheckRound>,
  command: PlanCheckRoundsCommand,
): boolean => {
  const observed = rounds.length - ineligibleIdsOf(command).length
  const deepest = Arr.reduce(
    fileNamesInOrder(command),
    0,
    (max, fileName) => Math.max(max, eligibleIdsOfFile(command, fileName).length),
  )
  return observed === deepest
}

const perFileEligibleOrderIsKept = (
  rounds: ReadonlyArray<CheckRound>,
  command: PlanCheckRoundsCommand,
): boolean => {
  const eligibleRounds = Arr.drop(rounds, ineligibleIdsOf(command).length)
  return Arr.every(
    fileNamesInOrder(command),
    (fileName) =>
      Equal.equals(observedIdsOfFile(eligibleRounds, command, fileName), eligibleIdsOfFile(command, fileName)),
  )
}

describe('planCheckRounds', (it) => {
  it.prop(
    '∀command_Rounds_≡PartitionOfIds',
    { of: [PLAN_CHECK_ROUNDS_COMMAND], subject: roundsOf },
    (subject, [command]) => partitioned(subject(command), command),
  )

  it.prop(
    '∀command_Rounds_≡IneligibleSolosFirst',
    { of: [PLAN_CHECK_ROUNDS_COMMAND], subject: roundsOf },
    (subject, [command]) => ineligibleLead(subject(command), command),
  )

  it.prop(
    '∀command_SharedRounds_≡EligibleDistinctFiles',
    { of: [PLAN_CHECK_ROUNDS_COMMAND], subject: roundsOf },
    (subject, [command]) => sharedRoundsHoldEligibleDistinctFiles(subject(command), command),
  )

  it.prop(
    '∀command_Rounds_≡DeepestFileLayerCount',
    { of: [PLAN_CHECK_ROUNDS_COMMAND], subject: roundsOf },
    (subject, [command]) => eligibleRoundCountMatchesDeepestFile(subject(command), command),
  )

  it.prop(
    '∀command_Rounds_≡PerFileEligibleOrder',
    { of: [PLAN_CHECK_ROUNDS_COMMAND], subject: roundsOf },
    (subject, [command]) => perFileEligibleOrderIsKept(subject(command), command),
  )
})
