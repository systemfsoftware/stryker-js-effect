import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { GroupMutantsCommand } from './CheckerCommands.schema.js'
import type { NodeDecodedShape } from './CheckMutants.schema.js'

const GroupingTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/Grouping')
type GroupingTypeId = typeof GroupingTypeId

export class MutantGroup extends S.TaggedClass<MutantGroup>()('MutantGroup', {
  ids: S.Array(S.String),
}) {
  readonly [GroupingTypeId] = GroupingTypeId
}

export const MutantGroups = S.Array(MutantGroup)
export type MutantGroups = typeof MutantGroups.Type

type FileNode = NodeDecodedShape
type Nodes = Readonly<Record<string, FileNode>>
type MutantWire = Checker.CheckerMutantWire

const nodeIn = (nodes: Nodes, fileName: string): Option.Option<FileNode> => Option.fromUndefinedOr(nodes[fileName])

const keepSome = <A>(option: Option.Option<A>): Result.Result<A, void> =>
  Option.match(option, {
    onNone: () => Result.failVoid,
    onSome: Result.succeed,
  })

interface MutantNode {
  readonly mutant: MutantWire
  readonly node: FileNode
}

interface MutantRound {
  readonly ids: ReadonlyArray<string>
  readonly members: HashSet.HashSet<string>
  readonly ignored: HashSet.HashSet<string>
  readonly taken: HashSet.HashSet<MutantWire>
}

const emptyRound: MutantRound = {
  ids: [],
  ignored: HashSet.empty(),
  members: HashSet.empty(),
  taken: HashSet.empty(),
}

const ancestorFileNamesOf = (node: FileNode, visited: HashSet.HashSet<string>): HashSet.HashSet<string> =>
  Boolean.match(HashSet.has(visited, node.fileName), {
    onTrue: () => visited,
    onFalse: () =>
      Arr.reduce(
        node.parents,
        HashSet.add(visited, node.fileName),
        (names, parent) => ancestorFileNamesOf(parent, names),
      ),
  })

const sharesDependencyPath = (node: FileNode, round: MutantRound): boolean =>
  Boolean.or(
    HashSet.has(round.ignored, node.fileName),
    Arr.some(Arr.fromIterable(ancestorFileNamesOf(node, HashSet.empty())), (name) => HashSet.has(round.members, name)),
  )

const joinRound = (round: MutantRound, { mutant, node }: MutantNode): MutantRound =>
  Boolean.match(sharesDependencyPath(node, round), {
    onFalse: () => ({
      ids: [...round.ids, mutant.id],
      ignored: HashSet.union(round.ignored, ancestorFileNamesOf(node, HashSet.empty())),
      members: HashSet.add(round.members, node.fileName),
      taken: HashSet.add(round.taken, mutant),
    }),
    onTrue: () => round,
  })

const takeRound = (remaining: ReadonlyArray<MutantNode>): MutantRound =>
  Arr.reduce(remaining, emptyRound, (round, candidate) => joinRound(round, candidate))

interface GroupingRun {
  readonly groups: ReadonlyArray<ReadonlyArray<string>>
  readonly remaining: ReadonlyArray<MutantNode>
}

const emptyGrouping = (remaining: ReadonlyArray<MutantNode>): GroupingRun => ({ groups: [], remaining })

const takeNextRound = (grouping: GroupingRun): GroupingRun =>
  Boolean.match(grouping.remaining.length === 0, {
    onTrue: () => grouping,
    onFalse: () => {
      const round = takeRound(grouping.remaining)
      return {
        groups: [...grouping.groups, round.ids],
        remaining: Arr.filter(grouping.remaining, (candidate) => !HashSet.has(round.taken, candidate.mutant)),
      }
    },
  })

const roundsOf = (inside: ReadonlyArray<MutantNode>): ReadonlyArray<ReadonlyArray<string>> => {
  const pending = Arr.dedupe(inside)
  return Arr.reduce(pending, emptyGrouping(pending), (grouping) => takeNextRound(grouping)).groups
}

const groupIds = (command: GroupMutantsCommand): ReadonlyArray<ReadonlyArray<string>> =>
  Boolean.match(command.prioritizePerformanceOverAccuracy, {
    onFalse: () => Arr.map(command.mutants, (mutant) => [mutant.id]),
    onTrue: () => {
      const inside = Arr.filterMap(
        command.mutants,
        (mutant) => keepSome(Option.map(nodeIn(command.nodes, mutant.fileName), (node) => ({ mutant, node }))),
      )
      const outside = Arr.filter(command.mutants, (mutant) => Option.isNone(nodeIn(command.nodes, mutant.fileName)))
      return Boolean.match(inside.length === 0, {
        onTrue: () => Arr.map(command.mutants, (mutant) => [mutant.id]),
        onFalse: () =>
          Boolean.match(outside.length === 0, {
            onTrue: () => roundsOf(inside),
            onFalse: () => [Arr.map(outside, (mutant) => mutant.id), ...roundsOf(inside)],
          }),
      })
    },
  })

const decide = (command: GroupMutantsCommand): Result.Result<MutantGroups, never> =>
  Result.succeed(Arr.map(groupIds(command), (ids) => MutantGroup.make({ ids })))

export const groupMutants = Workflow.make({
  command: GroupMutantsCommand,
  decision: MutantGroups,
  error: S.Never,
  decide,
})
