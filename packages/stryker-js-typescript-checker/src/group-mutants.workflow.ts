import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { GroupMutantsCommand } from './CheckerCommands.schema.js'

const GroupingTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/Grouping')
type GroupingTypeId = typeof GroupingTypeId

export class MutantGroup extends S.TaggedClass<MutantGroup>()('MutantGroup', {
  ids: S.Array(S.String),
}) {
  readonly [GroupingTypeId] = GroupingTypeId
}

export const MutantGroups = S.Array(MutantGroup)
export type MutantGroups = typeof MutantGroups.Type

type MutantWire = Checker.CheckerMutantWire

interface Batching {
  readonly files: ReadonlyArray<string>
  readonly idsByFile: HashMap.HashMap<string, ReadonlyArray<string>>
}

const emptyBatching: Batching = { files: [], idsByFile: HashMap.empty() }

const accumulate = (batching: Batching, mutant: MutantWire): Batching =>
  Option.match(HashMap.get(batching.idsByFile, mutant.fileName), {
    onNone: () => ({
      files: [...batching.files, mutant.fileName],
      idsByFile: HashMap.set(batching.idsByFile, mutant.fileName, [mutant.id]),
    }),
    onSome: (ids) => ({
      ...batching,
      idsByFile: HashMap.set(batching.idsByFile, mutant.fileName, [...ids, mutant.id]),
    }),
  })

const fileBatchesOf = (mutants: ReadonlyArray<MutantWire>): ReadonlyArray<ReadonlyArray<string>> => {
  const batching = Arr.reduce(mutants, emptyBatching, accumulate)
  return Arr.map(
    batching.files,
    (fileName) => Option.getOrElse(HashMap.get(batching.idsByFile, fileName), (): ReadonlyArray<string> => []),
  )
}

interface Packing {
  readonly groups: ReadonlyArray<ReadonlyArray<string>>
  readonly current: ReadonlyArray<string>
  readonly currentSize: number
}

const emptyPacking: Packing = { groups: [], current: [], currentSize: 0 }

const fitsWithin = (packing: Packing, bound: number, ids: ReadonlyArray<string>): boolean =>
  Boolean.or(packing.current.length === 0, packing.currentSize + ids.length <= bound)

const packFile = (bound: number) => (packing: Packing, ids: ReadonlyArray<string>): Packing =>
  Boolean.match(fitsWithin(packing, bound, ids), {
    onTrue: () => ({
      ...packing,
      current: [...packing.current, ...ids],
      currentSize: packing.currentSize + ids.length,
    }),
    onFalse: () => ({ groups: [...packing.groups, packing.current], current: ids, currentSize: ids.length }),
  })

const closePacking = (packing: Packing): ReadonlyArray<ReadonlyArray<string>> =>
  Boolean.match(packing.current.length === 0, {
    onTrue: () => packing.groups,
    onFalse: () => [...packing.groups, packing.current],
  })

const packBatches = (
  bound: number,
  batches: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<ReadonlyArray<string>> => closePacking(Arr.reduce(batches, emptyPacking, packFile(bound)))

const decide = (command: GroupMutantsCommand): Result.Result<MutantGroups, never> =>
  Result.succeed(
    Arr.map(packBatches(command.bound, fileBatchesOf(command.mutants)), (ids) => MutantGroup.make({ ids })),
  )

export const groupMutants = Workflow.make({
  command: GroupMutantsCommand,
  decision: MutantGroups,
  error: S.Never,
  decide,
})
