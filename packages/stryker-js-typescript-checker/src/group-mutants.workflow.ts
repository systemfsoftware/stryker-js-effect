import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { GroupMutantsCommand } from './CheckerCommands.schema.js'
import { fileIdsOf } from './FileIds.schema.js'

const GroupingTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/Grouping')
type GroupingTypeId = typeof GroupingTypeId

export class MutantGroup extends S.TaggedClass<MutantGroup>()('MutantGroup', {
  ids: S.Array(S.String),
}) {
  readonly [GroupingTypeId] = GroupingTypeId
}

export const MutantGroups = S.Array(MutantGroup)
export type MutantGroups = typeof MutantGroups.Type

const fileBatchesOf = (mutants: ReadonlyArray<Checker.CheckerMutantWire>): ReadonlyArray<ReadonlyArray<string>> =>
  Arr.map(fileIdsOf(mutants), (file) => file.ids)

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
