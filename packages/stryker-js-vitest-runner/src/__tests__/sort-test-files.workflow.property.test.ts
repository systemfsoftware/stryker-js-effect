import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { SortTestFiles, sortTestFiles, TestFileOrder } from '../sort-test-files.workflow.js'

const orderIndexOf = (order: readonly string[], file: string): number =>
  Option.getOrElse(Arr.findFirstIndex(order, (candidate) => candidate === file), () => Number.MAX_SAFE_INTEGER)

const isOrdered = (order: readonly string[], files: readonly string[]): boolean =>
  files.every((file, index) =>
    Option.match(Arr.get(files, index - 1), {
      onNone: () => true,
      onSome: (previous) => orderIndexOf(order, previous) <= orderIndexOf(order, file),
    })
  )

const moduleIdsOf = (result: Result.Result<readonly TestFileOrder[], never>): readonly string[] =>
  Result.match(result, { onFailure: () => [], onSuccess: (entries) => entries.map((entry) => entry.moduleId) })

const presentPriorityOf = (command: SortTestFiles): readonly string[] =>
  Arr.dedupe(command.priority).filter((file) => command.files.includes(file))

describe('sortTestFiles', (it) => {
  it.prop(
    '∀f_PriorityFiles_≡LeadInPriorityOrderThenOrderThenTheRest',
    { of: [SortTestFiles], subject: sortTestFiles },
    (subject, [command]) => {
      const moduleIds = moduleIdsOf(subject(command))
      const leads = presentPriorityOf(command)
      const tail = moduleIds.slice(leads.length)
      const tailRest = tail.filter((file) => !leads.includes(file))
      const rest = tailRest.filter((file) => !command.order.includes(file))
      const inputRest = command.files.filter((file) => !leads.includes(file) && !command.order.includes(file))
      return (
        moduleIds.length === command.files.length &&
        JSON.stringify([...moduleIds].sort()) === JSON.stringify([...command.files].sort()) &&
        JSON.stringify(moduleIds.slice(0, leads.length)) === JSON.stringify(leads) &&
        isOrdered(command.order, tailRest) &&
        JSON.stringify(rest) === JSON.stringify(inputRest)
      )
    },
  )

  it.prop(
    '∀f_PriorityWithoutPresence_≡SameOrderAsItsIntersection',
    { of: [SortTestFiles], subject: sortTestFiles },
    (subject, [command]) => {
      const restricted = SortTestFiles.make({
        files: command.files,
        order: command.order,
        priority: command.priority.filter((file) => command.files.includes(file)),
      })
      return JSON.stringify(moduleIdsOf(subject(command))) === JSON.stringify(moduleIdsOf(subject(restricted)))
    },
  )
})
