import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlanCheckRoundsCommand, type RoundCandidate } from './CheckerCommands.schema.js'

const RoundsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/CheckRounds')
type RoundsTypeId = typeof RoundsTypeId

export class SoloRound extends S.TaggedClass<SoloRound>()('SoloRound', {
  id: S.String,
}) {
  readonly [RoundsTypeId] = RoundsTypeId
}

export class SharedRound extends S.TaggedClass<SharedRound>()('SharedRound', {
  ids: S.Array(S.String).check(S.isMinLength(2)),
}) {
  readonly [RoundsTypeId] = RoundsTypeId
}

export const CheckRound = S.Union([SoloRound, SharedRound])
export type CheckRound = typeof CheckRound.Type

export const CheckRounds = S.Array(CheckRound)
export type CheckRounds = typeof CheckRounds.Type

interface EligibleFiles {
  readonly files: ReadonlyArray<string>
  readonly idsByFile: HashMap.HashMap<string, ReadonlyArray<string>>
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

const eligibleIdsOf = (files: EligibleFiles, fileName: string): ReadonlyArray<string> =>
  Option.getOrElse(HashMap.get(files.idsByFile, fileName), (): ReadonlyArray<string> => [])

const layerAt = (files: EligibleFiles, layer: number): ReadonlyArray<string> =>
  Arr.getSomes(Arr.map(files.files, (fileName) => Arr.get(eligibleIdsOf(files, fileName), layer)))

const layerCountOf = (files: EligibleFiles): number =>
  Arr.reduce(files.files, 0, (count, fileName) => Order.max(Order.Number)(count, eligibleIdsOf(files, fileName).length))

const roundOfLayer = (layer: ReadonlyArray<string>): CheckRound =>
  Option.match(Arr.head(layer), {
    onNone: () => SharedRound.make({ ids: layer }),
    onSome: (id) =>
      Boolean.match(layer.length === 1, {
        onTrue: () => SoloRound.make({ id }),
        onFalse: () => SharedRound.make({ ids: layer }),
      }),
  })

const layerRounds = (files: EligibleFiles): ReadonlyArray<CheckRound> => {
  const count = layerCountOf(files)
  return Boolean.match(count === 0, {
    onTrue: () => [],
    onFalse: () => Arr.map(Arr.range(0, count - 1), (layer) => roundOfLayer(layerAt(files, layer))),
  })
}

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
