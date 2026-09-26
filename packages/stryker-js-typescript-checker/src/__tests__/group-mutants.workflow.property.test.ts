import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'

import { GroupMutantsCommand } from '../CheckerCommands.schema.js'
import type { NodeDecodedShape } from '../CheckMutants.schema.js'
import { groupMutants } from '../group-mutants.workflow.js'

const groupsOf = (command: GroupMutantsCommand): ReadonlyArray<ReadonlyArray<string>> =>
  Result.match(groupMutants(command), {
    onFailure: () => [],
    onSuccess: (decision) => Arr.map(decision, (group) => group.ids),
  })

const singleGroupsOf = (command: GroupMutantsCommand): ReadonlyArray<ReadonlyArray<string>> =>
  Arr.map(command.mutants, (mutant) => [mutant.id])

const insideMutantsOf = (command: GroupMutantsCommand) =>
  Arr.filter(command.mutants, (mutant) => command.nodes[mutant.fileName] !== undefined)

const outsideMutantsOf = (command: GroupMutantsCommand) =>
  Arr.filter(command.mutants, (mutant) => command.nodes[mutant.fileName] === undefined)

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
  command: GroupMutantsCommand,
): ReadonlyArray<ReadonlyArray<NodeDecodedShape>> =>
  Arr.map(groups, (ids) =>
    Arr.filterMap(ids, (id) =>
      keepSome(
        Option.flatMap(
          Arr.findFirst(command.mutants, (mutant) => mutant.id === id),
          (mutant) => Option.fromUndefinedOr(command.nodes[mutant.fileName]),
        ),
      )))

const everyGroupIndependent = (groups: ReadonlyArray<ReadonlyArray<string>>, command: GroupMutantsCommand): boolean =>
  Arr.every(memberNodesOf(groups, command), (members) =>
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

describe('groupMutants', (it) => {
  it.prop(
    '∀command_Groups_≡Partition',
    { of: [GroupMutantsCommand], subject: groupsOf },
    (subject, [command]) =>
      Equal.equals(
        Arr.sort(Arr.flatten(subject(command)), Order.String),
        Arr.sort(Arr.map(command.mutants, (mutant) => mutant.id), Order.String),
      ),
  )

  it.prop(
    '∀command_Group_⊆Independent',
    { of: [GroupMutantsCommand], subject: groupsOf },
    (subject, [command]) => everyGroupIndependent(subject(command), command),
  )

  it.prop(
    '∀command_NotPrioritizing_≡Singletons',
    { of: [GroupMutantsCommand], subject: groupsOf },
    (subject, [command]) =>
      command.prioritizePerformanceOverAccuracy || Equal.equals(subject(command), singleGroupsOf(command)),
  )

  it.prop(
    '∀command_OutsideGraph_≡OwnRoundFirst',
    { of: [GroupMutantsCommand], subject: groupsOf },
    (subject, [command]) =>
      !command.prioritizePerformanceOverAccuracy ||
      insideMutantsOf(command).length === 0 ||
      outsideMutantsOf(command).length === 0 ||
      Equal.equals(Arr.head(subject(command)), Option.some(Arr.map(outsideMutantsOf(command), (mutant) => mutant.id))),
  )
})
