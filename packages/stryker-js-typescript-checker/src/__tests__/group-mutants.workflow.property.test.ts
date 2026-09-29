import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'

import { GroupMutantsCommand } from '../CheckerCommands.schema.js'
import { groupMutants } from '../group-mutants.workflow.js'

const groupsOf = (command: GroupMutantsCommand): ReadonlyArray<ReadonlyArray<string>> =>
  Result.match(groupMutants(command), {
    onFailure: () => [],
    onSuccess: (decision) => Arr.map(decision, (group) => group.ids),
  })

const fileNamesOf = (command: GroupMutantsCommand, ids: ReadonlyArray<string>): ReadonlyArray<string> =>
  Arr.getSomes(
    Arr.map(ids, (id) =>
      Option.map(
        Arr.findFirst(command.mutants, (mutant) => mutant.id === id),
        (mutant) => mutant.fileName,
      )),
  )

const everyGroupSharesOneFile = (
  groups: ReadonlyArray<ReadonlyArray<string>>,
  command: GroupMutantsCommand,
): boolean =>
  Arr.every(groups, (ids) => {
    const fileNames = fileNamesOf(command, ids)
    const first = fileNames[0] ?? ''
    return fileNames.length === ids.length && Arr.every(fileNames, (fileName) => fileName === first)
  })

describe('groupMutants', (it) => {
  it.prop(
    '∀command_Batches_≡Partition',
    { of: [GroupMutantsCommand], subject: groupsOf },
    (subject, [command]) =>
      Equal.equals(
        Arr.sort(Arr.flatten(subject(command)), Order.String),
        Arr.sort(Arr.map(command.mutants, (mutant) => mutant.id), Order.String),
      ),
  )

  it.prop(
    '∀command_Group_≡OneFile',
    { of: [GroupMutantsCommand], subject: groupsOf },
    (subject, [command]) => everyGroupSharesOneFile(subject(command), command),
  )
})
