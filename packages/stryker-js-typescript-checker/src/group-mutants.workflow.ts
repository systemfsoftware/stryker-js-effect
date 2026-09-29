import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
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

const batchIdsOf = (command: GroupMutantsCommand): ReadonlyArray<ReadonlyArray<string>> => {
  const batching = Arr.reduce(command.mutants, emptyBatching, accumulate)
  return Arr.map(
    batching.files,
    (fileName) => Option.getOrElse(HashMap.get(batching.idsByFile, fileName), (): ReadonlyArray<string> => []),
  )
}

const decide = (command: GroupMutantsCommand): Result.Result<MutantGroups, never> =>
  Result.succeed(Arr.map(batchIdsOf(command), (ids) => MutantGroup.make({ ids })))

export const groupMutants = Workflow.make({
  command: GroupMutantsCommand,
  decision: MutantGroups,
  error: S.Never,
  decide,
})
