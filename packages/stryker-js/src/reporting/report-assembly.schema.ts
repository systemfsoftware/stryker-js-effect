import type { RunMutantResult } from '@systemfsoftware/stryker-js-instrumenter'
import type * as schema from '@systemfsoftware/stryker-js-plugin-interface'
import type { TestResult } from '@systemfsoftware/stryker-js-plugin-interface'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export interface TestIdRemap {
  readonly testId: (id: string) => string
  readonly testIds: (ids: readonly string[] | undefined) => readonly string[] | undefined
}

export interface FileResultsInput {
  readonly sources: HashMap.HashMap<string, schema.FileResult>
  readonly reportNames: HashMap.HashMap<string, string>
  readonly mutants: readonly RunMutantResult[]
  readonly remap: TestIdRemap
}

export interface TestFilesInput {
  readonly testSources: HashMap.HashMap<string, schema.TestFile>
  readonly reportNames: HashMap.HashMap<string, string>
  readonly tests: readonly TestResult[]
  readonly remap: TestIdRemap
}

interface MutantGroup {
  readonly sourceFileName: string
  readonly mutants: readonly schema.MutantResult[]
}

interface TestGroup {
  readonly sourceFileName: string
  readonly tests: readonly schema.TestDefinition[]
}

const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.html': 'html',
  '.vue': 'html',
}

const extensionOf = (fileName: string): string => {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return Match.value(dot).pipe(
    Match.when((at) => at <= 0, () => ''),
    Match.orElse((at) => base.slice(at).toLowerCase()),
  )
}

const reportMutantOf = (mutant: RunMutantResult, remap: TestIdRemap): schema.MutantResult => ({
  id: mutant.id,
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  status: mutant.status,
  location: mutant.location,
  statusReason: mutant.statusReason,
  testsCompleted: mutant.testsCompleted,
  description: mutant.description,
  static: mutant.static,
  killedBy: remap.testIds(mutant.killedBy),
  coveredBy: remap.testIds(mutant.coveredBy),
})

const reportTestOf = (test: TestResult, remap: TestIdRemap): schema.TestDefinition =>
  Option.match(Option.fromUndefinedOr(test.startPosition), {
    onNone: (): schema.TestDefinition => ({ id: remap.testId(test.id), name: test.name }),
    onSome: (start) => ({ id: remap.testId(test.id), name: test.name, location: { start } }),
  })

const assembleMutantGroups = (input: FileResultsInput): HashMap.HashMap<string, MutantGroup> =>
  Arr.reduce(
    input.mutants,
    HashMap.empty<string, MutantGroup>(),
    (accumulator, mutant) =>
      Option.match(HashMap.get(input.reportNames, mutant.fileName), {
        onNone: () => accumulator,
        onSome: (reportName) => {
          const mapped = reportMutantOf(mutant, input.remap)
          return Option.match(HashMap.get(accumulator, reportName), {
            onNone: () => HashMap.set(accumulator, reportName, { sourceFileName: mutant.fileName, mutants: [mapped] }),
            onSome: (existing) =>
              HashMap.set(accumulator, reportName, {
                sourceFileName: existing.sourceFileName,
                mutants: [...existing.mutants, mapped],
              }),
          })
        },
      }),
  )

const assembleTestGroups = (input: TestFilesInput): HashMap.HashMap<string, TestGroup> =>
  Arr.reduce(
    input.tests,
    HashMap.empty<string, TestGroup>(),
    (accumulator, test) =>
      Option.match(Option.fromUndefinedOr(test.fileName), {
        onNone: () => accumulator,
        onSome: (testFileName) =>
          Option.match(HashMap.get(input.reportNames, testFileName), {
            onNone: () => accumulator,
            onSome: (reportName) => {
              const mapped = reportTestOf(test, input.remap)
              return Option.match(HashMap.get(accumulator, reportName), {
                onNone: () => HashMap.set(accumulator, reportName, { sourceFileName: testFileName, tests: [mapped] }),
                onSome: (existing) =>
                  HashMap.set(accumulator, reportName, {
                    sourceFileName: existing.sourceFileName,
                    tests: [...existing.tests, mapped],
                  }),
              })
            },
          }),
      }),
  )

const dictionaryOf = <Value>(
  grouped: HashMap.HashMap<string, { readonly sourceFileName: string }>,
  sources: HashMap.HashMap<string, Value>,
  merge: (source: Value, group: never) => never,
): Record<string, Value> =>
  Object.fromEntries(
    Arr.flatMap([...grouped], ([reportName, group]) =>
      Option.match(HashMap.get(sources, (group as { readonly sourceFileName: string }).sourceFileName), {
        onNone: (): ReadonlyArray<readonly [string, Value]> => [],
        onSome: (source): ReadonlyArray<readonly [string, Value]> => [[reportName, merge(source, group as never)]],
      })),
  )

export class ReportAssembly extends S.TaggedClass<ReportAssembly>()('ReportAssembly', {}) {
  static readonly language = (fileName: string): string =>
    EXTENSION_LANGUAGES[extensionOf(fileName)] ?? 'javascript'

  static readonly fileName = (relativePath: string | undefined): string =>
    Option.match(Option.fromUndefinedOr(relativePath), {
      onNone: () => '',
      onSome: (present) => present.replaceAll('\\', '/'),
    })

  static readonly testIdRemap = (testIds: readonly string[]): TestIdRemap => {
    const positions = HashMap.fromIterable(
      Arr.map(testIds, (id, position): readonly [string, string] => [id, position.toString()]),
    )
    const remapId = (id: string): string => Option.getOrElse(HashMap.get(positions, id), () => id)
    return {
      testId: remapId,
      testIds: (ids) =>
        Option.match(Option.fromUndefinedOr(ids), {
          onNone: () => undefined,
          onSome: (present) => Arr.map(present, remapId),
        }),
    }
  }

  static readonly fileResults = (input: FileResultsInput): schema.FileResultDictionary =>
    dictionaryOf(assembleMutantGroups(input), input.sources, (source, group: MutantGroup) => ({
      ...source,
      mutants: group.mutants,
    })) as schema.FileResultDictionary

  static readonly testFiles = (input: TestFilesInput): schema.TestFileDefinitionDictionary =>
    dictionaryOf(assembleTestGroups(input), input.testSources, (source, group: TestGroup) => ({
      ...source,
      tests: group.tests,
    })) as schema.TestFileDefinitionDictionary
}
