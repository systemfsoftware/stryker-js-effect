import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { GroupMutantsCommand } from '../CheckerCommands.schema.js'
import type { NodeDecodedShape } from '../CheckMutants.schema.js'
import { groupMutants, type MutantGroup } from '../group-mutants.workflow.js'

const FILE_INDEX_LIMIT = 4

const indexSchema = () => S.Int.check(S.isBetween({ minimum: 0, maximum: FILE_INDEX_LIMIT }))
const edgesSchema = () => S.Array(S.Tuple([indexSchema(), indexSchema()])).check(S.isMaxLength(6))
const fileIndexesSchema = () => S.Array(indexSchema()).check(S.isMaxLength(6))

const fileNameOf = (index: number) => `src/file-${index}.ts`

const linkedNode = (fileName: string, parents: ReadonlyArray<NodeDecodedShape>): NodeDecodedShape => ({
  children: [],
  fileName,
  parents,
})

const graphSizeOf = (edges: ReadonlyArray<readonly [number, number]>): number =>
  1 + Arr.reduce(edges, 0, (largest, [child, parent]) => Math.max(largest, child, parent))

const parentsOf = (index: number, edges: ReadonlyArray<readonly [number, number]>): ReadonlyArray<NodeDecodedShape> =>
  Arr.map(
    Arr.filter(edges, ([child]) => child === index),
    ([, parent]) => linkedNode(fileNameOf(parent), []),
  )

const nodesOfEdges = (edges: ReadonlyArray<readonly [number, number]>): Record<string, NodeDecodedShape> =>
  Object.fromEntries(
    Arr.map(Arr.range(0, graphSizeOf(edges) - 1), (index) => [
      fileNameOf(index),
      linkedNode(fileNameOf(index), parentsOf(index, edges)),
    ]),
  )

const mutantWireOf = (id: string, fileName: string): Checker.CheckerMutantWire =>
  Checker.CheckerMutantWire.make({
    id: Mutant.MutantId.make(id),
    fileName: Mutant.CanonicalFileName.make(fileName),
    mutatorName: Mutant.MutatorName.make('foo-mutator'),
    replacement: 'x',
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  })

const mutantsOf = (fileIndexes: ReadonlyArray<number>) =>
  Arr.map(fileIndexes, (index, position) => mutantWireOf(`${position}`, fileNameOf(index)))

const groupsOf = (result: Result.Result<ReadonlyArray<MutantGroup>, never>): ReadonlyArray<ReadonlyArray<string>> =>
  Result.match(result, {
    onFailure: () => [],
    onSuccess: (decision) => Arr.map(decision, (group) => group.ids),
  })

const groupedFor = (
  edges: ReadonlyArray<readonly [number, number]>,
  fileIndexes: ReadonlyArray<number>,
  prioritize: boolean,
): ReadonlyArray<ReadonlyArray<string>> =>
  groupsOf(
    groupMutants(
      GroupMutantsCommand.make({
        mutants: mutantsOf(fileIndexes),
        nodes: nodesOfEdges(edges),
        prioritizePerformanceOverAccuracy: prioritize,
      }),
    ),
  )

const seenNamesOf = (node: NodeDecodedShape): ReadonlyArray<string> => [
  node.fileName,
  ...Arr.flatMap(node.parents, seenNamesOf),
]

const relatedNodes = (left: NodeDecodedShape, right: NodeDecodedShape): boolean =>
  seenNamesOf(left).includes(right.fileName) || seenNamesOf(right).includes(left.fileName)

const keepSome = <A>(option: Option.Option<A>): Result.Result<A, void> =>
  Option.match(option, { onNone: () => Result.failVoid, onSome: Result.succeed })

const memberNodesOf = (
  groups: ReadonlyArray<ReadonlyArray<string>>,
  mutants: ReadonlyArray<Checker.CheckerMutantWire>,
  nodes: Record<string, NodeDecodedShape>,
): ReadonlyArray<ReadonlyArray<NodeDecodedShape>> =>
  Arr.map(groups, (ids) =>
    Arr.filterMap(ids, (id) =>
      keepSome(
        Option.flatMap(
          Arr.findFirst(mutants, (mutant) => mutant.id === id),
          (mutant) => Option.fromUndefinedOr(nodes[mutant.fileName]),
        ),
      )))

const everyGroupIndependent = (
  groups: ReadonlyArray<ReadonlyArray<string>>,
  mutants: ReadonlyArray<Checker.CheckerMutantWire>,
  nodes: Record<string, NodeDecodedShape>,
): boolean =>
  Arr.every(memberNodesOf(groups, mutants, nodes), (members) =>
    Arr.every(
      Arr.flatMap(
        members,
        (left, index) =>
          Arr.map(
            Arr.drop(members, index + 1),
            (right): readonly [NodeDecodedShape, NodeDecodedShape] => [left, right],
          ),
      ),
      ([left, right]) => !relatedNodes(left, right),
    ))

interface Assignment {
  readonly ids: ReadonlyArray<string>
  readonly members: ReadonlyArray<NodeDecodedShape>
}

const firstFitGrouping = (
  mutants: ReadonlyArray<Checker.CheckerMutantWire>,
  nodes: Record<string, NodeDecodedShape>,
  prioritize: boolean,
): ReadonlyArray<ReadonlyArray<string>> => {
  if (!prioritize) {
    return mutants.map((mutant) => [mutant.id])
  }
  const inside = mutants.filter((mutant) => nodes[mutant.fileName] !== undefined)
  const outside = mutants.filter((mutant) => nodes[mutant.fileName] === undefined)
  if (inside.length === 0) {
    return mutants.map((mutant) => [mutant.id])
  }
  const assignments = inside.reduce<ReadonlyArray<Assignment>>((groups, mutant) => {
    const node = nodes[mutant.fileName]
    if (node === undefined) {
      return groups
    }
    const index = groups.findIndex((group) => !group.members.some((member) => relatedNodes(member, node)))
    if (index < 0) {
      return [...groups, { ids: [mutant.id], members: [node] }]
    }
    return groups.map((
      group,
      at,
    ) => (at === index ? { ids: [...group.ids, mutant.id], members: [...group.members, node] } : group))
  }, [])
  const created = assignments.map((group) => group.ids)
  return outside.length === 0 ? created : [outside.map((mutant) => mutant.id), ...created]
}

describe('groupMutants', (it) => {
  it.prop(
    '∀graph_Mutants_≡ReferenceFirstFit',
    { of: [edgesSchema(), fileIndexesSchema(), S.Boolean], subject: groupedFor },
    (subject, [edges, fileIndexes, prioritize]) =>
      Equal.equals(
        subject(edges, fileIndexes, prioritize),
        firstFitGrouping(mutantsOf(fileIndexes), nodesOfEdges(edges), prioritize),
      ),
  )

  it.prop(
    '∀graph_Mutants_≡Partition',
    { of: [edgesSchema(), fileIndexesSchema(), S.Boolean], subject: groupedFor },
    (subject, [edges, fileIndexes, prioritize]) => {
      const mutants = mutantsOf(fileIndexes)
      const placed = Arr.flatten(subject(edges, fileIndexes, prioritize))
      const expected = Arr.map(mutants, (mutant) => mutant.id)
      return (
        placed.length === mutants.length &&
        HashSet.size(HashSet.fromIterable(placed)) === mutants.length &&
        HashSet.size(HashSet.fromIterable([...placed, ...expected])) === mutants.length
      )
    },
  )

  it.prop(
    '∀mutants_OutsideGraph_≡OwnRoundFirst',
    { of: [edgesSchema(), fileIndexesSchema().check(S.isMinLength(1))], subject: groupedFor },
    (subject, [edges, fileIndexes]) => {
      const nodes = nodesOfEdges(edges)
      const mutants = mutantsOf(fileIndexes)
      const outsideIds = mutants.filter((mutant) => nodes[mutant.fileName] === undefined).map((mutant) => mutant.id)
      if (outsideIds.length === 0) {
        return true
      }
      const groups = subject(edges, fileIndexes, true)
      const placed = Arr.flatten(groups)
      const singles = mutants.map((mutant) => [mutant.id])
      const anyInside = mutants.some((mutant) => nodes[mutant.fileName] !== undefined)
      return (
        placed.length === mutants.length &&
        HashSet.size(HashSet.fromIterable(placed)) === mutants.length &&
        (anyInside ? Equal.equals(Arr.head(groups), Option.some(outsideIds)) : Equal.equals(groups, singles))
      )
    },
  )

  it.prop(
    '∀graph_Group_⊆Independent',
    { of: [edgesSchema(), fileIndexesSchema()], subject: groupedFor },
    (subject, [edges, fileIndexes]) =>
      everyGroupIndependent(subject(edges, fileIndexes, true), mutantsOf(fileIndexes), nodesOfEdges(edges)),
  )
})
