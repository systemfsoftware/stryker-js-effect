import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlanCheckRoundsCommand, type RoundCandidate } from './CheckerCommands.schema.js'
import { type CheckRound, CheckRounds, roundOfLayer, SoloRound } from './CheckRound.schema.js'

interface EligibleFiles {
  readonly files: ReadonlyArray<string>
  readonly idsByFile: HashMap.HashMap<string, ReadonlyArray<Mutant.MutantId>>
}

const emptyEligible: EligibleFiles = { files: [], idsByFile: HashMap.empty() }

const accumulateEligible = (files: EligibleFiles, candidate: RoundCandidate): EligibleFiles =>
  Boolean.match(candidate.eligible, {
    onFalse: () => files,
    onTrue: () =>
      Option.match(HashMap.get(files.idsByFile, candidate.fileName), {
        onNone: () => ({
          files: [...files.files, candidate.fileName],
          idsByFile: HashMap.set(files.idsByFile, candidate.fileName, [candidate.id]),
        }),
        onSome: (ids) => ({
          ...files,
          idsByFile: HashMap.set(files.idsByFile, candidate.fileName, [...ids, candidate.id]),
        }),
      }),
  })

const eligibleIdsOf = (files: EligibleFiles, fileName: string): ReadonlyArray<Mutant.MutantId> =>
  Option.getOrElse(HashMap.get(files.idsByFile, fileName), (): ReadonlyArray<Mutant.MutantId> => [])

const layerAt = (files: EligibleFiles, layer: number): Option.Option<Arr.NonEmptyReadonlyArray<Mutant.MutantId>> =>
  Option.liftPredicate(Arr.isReadonlyArrayNonEmpty<Mutant.MutantId>)(
    Arr.getSomes(Arr.map(files.files, (fileName) => Arr.get(eligibleIdsOf(files, fileName), layer))),
  )

const layerCountOf = (files: EligibleFiles): number =>
  Arr.reduce(files.files, 0, (count, fileName) => Order.max(Order.Number)(count, eligibleIdsOf(files, fileName).length))

const layerRounds = (files: EligibleFiles): ReadonlyArray<CheckRound> =>
  Arr.getSomes(
    Arr.map(Arr.range(0, layerCountOf(files) - 1), (layer) => Option.map(layerAt(files, layer), roundOfLayer)),
  )

const ineligibleSolos = (candidates: ReadonlyArray<RoundCandidate>): ReadonlyArray<CheckRound> =>
  Arr.map(
    Arr.filter(candidates, (candidate) => !candidate.eligible),
    (candidate) => SoloRound.make({ id: candidate.id }),
  )

const planRounds = (candidates: ReadonlyArray<RoundCandidate>): CheckRounds => {
  const files = Arr.reduce(candidates, emptyEligible, accumulateEligible)
  return Arr.appendAll(ineligibleSolos(candidates), layerRounds(files))
}

const decide = (command: PlanCheckRoundsCommand): Result.Result<CheckRounds, never> =>
  Result.succeed(planRounds(command.candidates))

export const planCheckRounds = Workflow.make({
  command: PlanCheckRoundsCommand,
  decision: CheckRounds,
  error: S.Never,
  decide,
})
