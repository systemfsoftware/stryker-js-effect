import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
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

interface FileClosures {
  readonly dependents: HashSet.HashSet<string>
  readonly dependencies: HashSet.HashSet<string>
}

interface ClosedMutant {
  readonly mutant: MutantWire
  readonly fileName: string
  readonly closures: FileClosures
}

interface MutantRound {
  readonly ids: ReadonlyArray<string>
  readonly dependents: HashSet.HashSet<string>
  readonly dependencies: HashSet.HashSet<string>
  readonly taken: HashSet.HashSet<MutantWire>
}

const emptyRound: MutantRound = {
  ids: [],
  dependents: HashSet.empty(),
  dependencies: HashSet.empty(),
  taken: HashSet.empty(),
}

const resolvedIn = (nodes: Nodes, stub: FileNode): FileNode =>
  Option.getOrElse(nodeIn(nodes, stub.fileName), () => stub)

const reachableFileNamesOf = (
  node: FileNode,
  nodes: Nodes,
  next: (node: FileNode) => ReadonlyArray<FileNode>,
  visited: HashSet.HashSet<string>,
): HashSet.HashSet<string> =>
  Boolean.match(HashSet.has(visited, node.fileName), {
    onTrue: () => visited,
    onFalse: () =>
      Arr.reduce(
        next(node),
        HashSet.add(visited, node.fileName),
        (names, neighbour) => reachableFileNamesOf(resolvedIn(nodes, neighbour), nodes, next, names),
      ),
  })

const closuresOf = (node: FileNode, nodes: Nodes): FileClosures => ({
  dependents: reachableFileNamesOf(node, nodes, (current) => current.parents, HashSet.empty()),
  dependencies: reachableFileNamesOf(node, nodes, (current) => current.children, HashSet.empty()),
})

const closedMutantsOf = (inside: ReadonlyArray<MutantNode>, nodes: Nodes): ReadonlyArray<ClosedMutant> => {
  const closuresByFile = Arr.reduce(
    inside,
    HashMap.empty<string, FileClosures>(),
    (closures, { node }) =>
      Boolean.match(HashMap.has(closures, node.fileName), {
        onTrue: () => closures,
        onFalse: () => HashMap.set(closures, node.fileName, closuresOf(node, nodes)),
      }),
  )
  return Arr.filterMap(inside, ({ mutant, node }) =>
    keepSome(
      Option.map(HashMap.get(closuresByFile, node.fileName), (closures) => ({
        mutant,
        fileName: node.fileName,
        closures,
      })),
    ))
}

const sharesDependencyPath = (candidate: ClosedMutant, round: MutantRound): boolean =>
  Boolean.or(
    HashSet.has(round.dependents, candidate.fileName),
    HashSet.has(round.dependencies, candidate.fileName),
  )

const joinRound = (round: MutantRound, candidate: ClosedMutant): MutantRound =>
  Boolean.match(sharesDependencyPath(candidate, round), {
    onFalse: () => ({
      ids: [...round.ids, candidate.mutant.id],
      dependents: HashSet.union(round.dependents, candidate.closures.dependents),
      dependencies: HashSet.union(round.dependencies, candidate.closures.dependencies),
      taken: HashSet.add(round.taken, candidate.mutant),
    }),
    onTrue: () => round,
  })

const takeRound = (remaining: ReadonlyArray<ClosedMutant>): MutantRound => Arr.reduce(remaining, emptyRound, joinRound)

interface GroupingRun {
  readonly groups: ReadonlyArray<ReadonlyArray<string>>
  readonly remaining: ReadonlyArray<ClosedMutant>
}

const emptyGrouping = (remaining: ReadonlyArray<ClosedMutant>): GroupingRun => ({ groups: [], remaining })

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

const roundsOf = (inside: ReadonlyArray<MutantNode>, nodes: Nodes): ReadonlyArray<ReadonlyArray<string>> => {
  const pending = closedMutantsOf(Arr.dedupe(inside), nodes)
  return Arr.reduce(pending, emptyGrouping(pending), takeNextRound).groups
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
            onTrue: () => roundsOf(inside, command.nodes),
            onFalse: () => [Arr.map(outside, (mutant) => mutant.id), ...roundsOf(inside, command.nodes)],
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
