import { describe, it } from '@systemfsoftware/vitest'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { ImportClosureCommand, type TestFileClosure } from '../import-closure.schema.js'
import { importClosure } from '../import-closure.workflow.js'

type ClosureSubject = (command: ImportClosureCommand) => Result.Result<readonly TestFileClosure[], never>

const decisionsOf = (subject: ClosureSubject, command: ImportClosureCommand): readonly TestFileClosure[] =>
  Result.match(subject(command), { onFailure: () => [], onSuccess: (closures) => closures })

const forFirstClosure = (
  subject: ClosureSubject,
  command: ImportClosureCommand,
  check: (closure: TestFileClosure) => boolean,
): boolean => {
  const decisions = decisionsOf(subject, command)
  return Option.match(Option.fromNullishOr(decisions[0]), {
    onNone: () => decisions.length === command.testFiles.length,
    onSome: (closure) => check(closure) && decisions.length === command.testFiles.length,
  })
}

const commandWithReversedModules = (command: ImportClosureCommand): ImportClosureCommand =>
  ImportClosureCommand.make({
    modules: Object.fromEntries(
      Object.entries(command.modules)
        .reverse()
        .map(([file, record]) => [file, { ...record, dependencies: [...record.dependencies].reverse() }]),
    ),
    globalInputs: [...command.globalInputs],
    testFiles: [...command.testFiles],
  })

describe('importClosure', () => {
  it.prop(
    '∀c_Command_≡OneClosurePerTestFileInOrder',
    { of: [ImportClosureCommand], subject: importClosure },
    (subject, [command]) =>
      decisionsOf(subject, command).every((closure, index) => closure.testFile === command.testFiles[index]),
  )

  it.prop(
    '∀c_Command_≡EveryClosureHoldsItsTestFileAndEveryGlobalInput',
    { of: [ImportClosureCommand], subject: importClosure },
    (subject, [command]) =>
      forFirstClosure(
        subject,
        command,
        (closure) =>
          closure.files.includes(closure.testFile) &&
          command.globalInputs.every((file) => closure.files.includes(file)) &&
          closure.files.every((file, position) => position === 0 || closure.files[position - 1] !== file),
      ),
  )

  it.prop(
    '∀c_Command_≡AnAbsentTestFileOpensItsClosure',
    { of: [ImportClosureCommand], subject: importClosure },
    (subject, [command]) =>
      forFirstClosure(subject, command, (closure) => closure.open || Object.hasOwn(command.modules, closure.testFile)),
  )

  it.prop(
    '∀c_Command_≡AnOpenMemberOpensTheClosure',
    { of: [ImportClosureCommand], subject: importClosure },
    (subject, [command]) =>
      forFirstClosure(
        subject,
        command,
        (closure) => closure.open || closure.files.every((file) => command.modules[file]?.open !== true),
      ),
  )

  it.prop(
    '∀c_Command_≡AMissingDependencyOpensTheClosure',
    { of: [ImportClosureCommand], subject: importClosure },
    (subject, [command]) =>
      forFirstClosure(
        subject,
        command,
        (closure) =>
          closure.open ||
          closure.files.every((file) =>
            (command.modules[file]?.dependencies ?? []).every((dependency) =>
              Object.hasOwn(command.modules, dependency)
            )
          ),
      ),
  )

  it.prop(
    '∀c_ModuleOrder_≡ClosureUnchanged',
    { of: [ImportClosureCommand], subject: importClosure },
    (subject, [command]) => {
      const original = decisionsOf(subject, command)
      const reordered = decisionsOf(subject, commandWithReversedModules(command))
      return (
        original.length === reordered.length &&
        original.every((closure, index) => {
          const other = reordered[index]
          return (
            other !== undefined &&
            closure.testFile === other.testFile &&
            closure.open === other.open &&
            closure.files.join(',') === other.files.join(',')
          )
        })
      )
    },
  )
})
