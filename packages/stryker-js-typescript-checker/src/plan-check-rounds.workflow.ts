import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlanCheckRoundsCommand, type RoundCandidate } from './CheckerCommands.schema.js'
import { type CheckRound, CheckRounds, roundOfLayer, SoloRound } from './CheckRound.schema.js'
import { type FileIds, fileIdsOf } from './FileIds.schema.js'

const layerAt = (
  files: ReadonlyArray<FileIds>,
  layer: number,
): Option.Option<Arr.NonEmptyReadonlyArray<Mutant.MutantId>> =>
  Option.liftPredicate(Arr.isReadonlyArrayNonEmpty<Mutant.MutantId>)(
    Arr.getSomes(Arr.map(files, (file) => Arr.get(file.ids, layer))),
  )

const layerCountOf = (files: ReadonlyArray<FileIds>): number =>
  Arr.reduce(files, 0, (count, file) => Order.max(Order.Number)(count, file.ids.length))

const layerRounds = (files: ReadonlyArray<FileIds>): ReadonlyArray<CheckRound> =>
  Arr.getSomes(
    Arr.map(Arr.range(0, layerCountOf(files) - 1), (layer) => Option.map(layerAt(files, layer), roundOfLayer)),
  )

const ineligibleSolos = (candidates: ReadonlyArray<RoundCandidate>): ReadonlyArray<CheckRound> =>
  Arr.map(
    Arr.filter(candidates, (candidate) => !candidate.eligible),
    (candidate) => SoloRound.make({ id: candidate.id }),
  )

const planRounds = (candidates: ReadonlyArray<RoundCandidate>): CheckRounds =>
  Arr.appendAll(
    ineligibleSolos(candidates),
    layerRounds(fileIdsOf(Arr.filter(candidates, (candidate) => candidate.eligible))),
  )

const decide = (command: PlanCheckRoundsCommand): Result.Result<CheckRounds, never> =>
  Result.succeed(planRounds(command.candidates))

export const planCheckRounds = Workflow.make({
  command: PlanCheckRoundsCommand,
  decision: CheckRounds,
  error: S.Never,
  decide,
})
