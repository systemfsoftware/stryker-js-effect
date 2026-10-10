import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ImportClosureCommand,
  type ImportClosureModule,
  type ImportClosureModuleTable,
  TestFileClosure,
} from './import-closure.schema.js'

const moduleAt = (modules: ImportClosureModuleTable, file: string): ImportClosureModule | undefined =>
  Boolean.match(Object.hasOwn(modules, file), {
    onTrue: () => modules[file],
    onFalse: () => undefined,
  })

const dependenciesOf = (modules: ImportClosureModuleTable, file: string): readonly string[] =>
  Option.getOrElse(
    Option.map(Option.fromUndefinedOr(moduleAt(modules, file)), (record) => record.dependencies),
    () => [],
  )

const expanded = (modules: ImportClosureModuleTable, files: HashSet.HashSet<string>): HashSet.HashSet<string> =>
  HashSet.fromIterable([...files, ...[...files].flatMap((file) => dependenciesOf(modules, file))])

const reachableFiles = (
  modules: ImportClosureModuleTable,
  files: HashSet.HashSet<string>,
): HashSet.HashSet<string> => {
  const next = expanded(modules, files)
  return Boolean.match(HashSet.size(next) === HashSet.size(files), {
    onTrue: () => next,
    onFalse: () => reachableFiles(modules, next),
  })
}

const missingMember = (modules: ImportClosureModuleTable, file: string): boolean =>
  moduleAt(modules, file) === undefined

const memberOpen = (modules: ImportClosureModuleTable, files: HashSet.HashSet<string>): boolean =>
  [...files].some((file) => Option.exists(Option.fromUndefinedOr(moduleAt(modules, file)), (record) => record.open))

const dependencyMissing = (modules: ImportClosureModuleTable, files: HashSet.HashSet<string>): boolean =>
  [...files].some((file) => dependenciesOf(modules, file).some((dependency) => missingMember(modules, dependency)))

const entryMissing = (command: ImportClosureCommand, testFile: string): boolean =>
  missingMember(command.modules, testFile)

const globalInputMissing = (command: ImportClosureCommand): boolean =>
  command.globalInputs.some((file) => missingMember(command.modules, file))

const closureOpen = (
  command: ImportClosureCommand,
  files: HashSet.HashSet<string>,
  testFile: string,
): boolean =>
  [
    entryMissing(command, testFile),
    memberOpen(command.modules, files),
    dependencyMissing(command.modules, files),
    globalInputMissing(command),
  ].some((flag) => flag)

const closureOf = (command: ImportClosureCommand, testFile: string): TestFileClosure => {
  const files = HashSet.union(
    reachableFiles(command.modules, HashSet.fromIterable([testFile])),
    HashSet.fromIterable(command.globalInputs),
  )
  return TestFileClosure.make({
    testFile,
    files: [...files].sort(),
    open: closureOpen(command, files, testFile),
  })
}

const decide = (command: ImportClosureCommand): Result.Result<readonly TestFileClosure[], never> =>
  Result.succeed(command.testFiles.map((testFile) => closureOf(command, testFile)))

export const importClosure = Workflow.make({
  command: ImportClosureCommand,
  decision: S.Array(TestFileClosure),
  error: S.Never,
  decide,
})
