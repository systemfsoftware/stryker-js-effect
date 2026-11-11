import { describe } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'

import { GroupMutantsCommand } from '../CheckerCommands.schema.js'
import { groupMutants } from '../group-mutants.workflow.js'

const SMALL_BOUND_MODULUS = 6
const FILE_POOL_SIZE = 3

const GROUP_MUTANTS_COMMAND = Arbitrary.map(Arbitrary.schema(GroupMutantsCommand), (command) => {
  const pool = Arr.take(
    Arr.fromIterable(new Set(Arr.map(command.mutants, (mutant) => mutant.fileName))),
    FILE_POOL_SIZE,
  )
  return GroupMutantsCommand.make({
    mutants: Arr.map(command.mutants, (mutant, index) => ({
      ...mutant,
      fileName: Option.getOrElse(Arr.get(pool, index % pool.length), () => mutant.fileName),
    })),
    bound: (command.bound % SMALL_BOUND_MODULUS) + 1,
  })
})

const groupsOf = (command: GroupMutantsCommand): ReadonlyArray<ReadonlyArray<string>> =>
  Result.match(groupMutants(command), {
    onFailure: () => [],
    onSuccess: (decision) => Arr.map(decision, (group) => group.ids),
  })

const fileNamesInOrder = (command: GroupMutantsCommand): ReadonlyArray<string> => {
  const names: string[] = []
  for (const mutant of command.mutants) {
    if (!names.includes(mutant.fileName)) names.push(mutant.fileName)
  }
  return names
}

const fileNameOf = (command: GroupMutantsCommand, id: string): string | undefined =>
  command.mutants.find((mutant) => mutant.id === id)?.fileName

const idsOfFile = (command: GroupMutantsCommand, fileName: string): ReadonlyArray<string> =>
  Arr.map(
    Arr.filter(command.mutants, (mutant) => mutant.fileName === fileName),
    (mutant) => mutant.id,
  )

const partitioned = (
  groups: ReadonlyArray<ReadonlyArray<string>>,
  command: GroupMutantsCommand,
): boolean =>
  Equal.equals(
    Arr.sort(Arr.flatten(groups), Order.String),
    Arr.sort(Arr.map(command.mutants, (mutant) => mutant.id), Order.String),
  )

const fileSitsInOneContiguousGroup = (
  groups: ReadonlyArray<ReadonlyArray<string>>,
  expected: ReadonlyArray<string>,
): boolean => {
  const first = expected[0]
  if (first === undefined) return true
  const owner = groups.findIndex((group) => group.includes(first))
  if (owner === -1) return false
  const group = groups[owner] ?? []
  const start = group.indexOf(first)
  return (
    start !== -1 &&
    expected.every((id, offset) => group[start + offset] === id) &&
    expected.every((id) => groups.findIndex((candidate) => candidate.includes(id)) === owner)
  )
}

const filesFollowFirstAppearance = (
  groups: ReadonlyArray<ReadonlyArray<string>>,
  command: GroupMutantsCommand,
): boolean => {
  const run = Arr.dedupe(Arr.map(Arr.flatten(groups), (id) => fileNameOf(command, id)))
  const expected = fileNamesInOrder(command)
  return run.length === expected.length && Arr.every(run, (fileName, index) => fileName === expected[index])
}

const respectsBound = (
  groups: ReadonlyArray<ReadonlyArray<string>>,
  command: GroupMutantsCommand,
): boolean =>
  groups.every((group) => {
    const fileNames = new Set(group.map((id) => fileNameOf(command, id)))
    return fileNames.size === 1 || group.length <= command.bound
  })

const packingIsMaximal = (
  groups: ReadonlyArray<ReadonlyArray<string>>,
  command: GroupMutantsCommand,
): boolean =>
  groups.every((group, index) => {
    const firstOfNext = groups[index + 1]?.[0]
    const nextFile = firstOfNext === undefined ? undefined : fileNameOf(command, firstOfNext)
    return nextFile === undefined || group.length + idsOfFile(command, nextFile).length > command.bound
  })

describe('groupMutants', (it) => {
  it.prop(
    '∀command_Groups_≡PartitionOfIds',
    { of: [GROUP_MUTANTS_COMMAND], subject: groupsOf },
    (subject, [command]) => partitioned(subject(command), command),
  )

  it.prop(
    '∀command_Groups_≡WholeFilesContiguousInOneGroup',
    { of: [GROUP_MUTANTS_COMMAND], subject: groupsOf },
    (subject, [command]) => {
      const groups = subject(command)
      return Arr.every(
        fileNamesInOrder(command),
        (fileName) => fileSitsInOneContiguousGroup(groups, idsOfFile(command, fileName)),
      )
    },
  )

  it.prop(
    '∀command_Groups_≡FilesFollowFirstAppearance',
    { of: [GROUP_MUTANTS_COMMAND], subject: groupsOf },
    (subject, [command]) => filesFollowFirstAppearance(subject(command), command),
  )

  it.prop(
    '∀command_Groups_≡BoundedUnlessOneFile',
    { of: [GROUP_MUTANTS_COMMAND], subject: groupsOf },
    (subject, [command]) => respectsBound(subject(command), command),
  )

  it.prop(
    '∀command_Groups_≡MaximalPacking',
    { of: [GROUP_MUTANTS_COMMAND], subject: groupsOf },
    (subject, [command]) => packingIsMaximal(subject(command), command),
  )
})
