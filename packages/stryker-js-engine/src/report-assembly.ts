import type { FormatRegistry } from '@systemfsoftware/stryker-js-instrumenter'
import type { RunMutantResult } from '@systemfsoftware/stryker-js-language'
import type * as schema from '@systemfsoftware/stryker-js-language'
import type { TestResult } from '@systemfsoftware/stryker-js-language'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'

import type { FileFormatIdentity } from './IncrementalDiff.schema.js'
import type { PluginFrameworkEntry } from './Plugins.js'

const extensionOf = (fileName: string): string => {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return ''
  }
  return base.slice(dot).toLowerCase()
}

export const determineLanguage = (registry: FormatRegistry, fileName: string): string =>
  Option.match(registry.entryForExtension(extensionOf(fileName)), {
    onNone: () => 'javascript',
    onSome: (entry) => entry.claim.language,
  })

const fileFormatIdentity = (
  registry: FormatRegistry,
  ownerVersions: Readonly<Record<string, string>>,
  fileName: string,
): FileFormatIdentity | undefined =>
  Option.match(registry.entryForExtension(extensionOf(fileName)), {
    onNone: () => undefined,
    onSome: (entry) => ({
      formatId: entry.claim.formatId,
      ownerModule: entry.owner,
      ownerVersion: Option.getOrElse(Option.fromUndefinedOr(ownerVersions[entry.owner]), () => ''),
    }),
  })

export const fileFormatIdentities = (
  registry: FormatRegistry,
  ownerVersions: Readonly<Record<string, string>>,
  fileNames: readonly string[],
): Readonly<Record<string, FileFormatIdentity>> =>
  Object.fromEntries(
    fileNames.flatMap((fileName): ReadonlyArray<readonly [string, FileFormatIdentity]> =>
      Option.match(Option.fromUndefinedOr(fileFormatIdentity(registry, ownerVersions, fileName)), {
        onNone: (): ReadonlyArray<readonly [string, FileFormatIdentity]> => [],
        onSome: (identity): ReadonlyArray<readonly [string, FileFormatIdentity]> => [[fileName, identity]],
      })
    ),
  )

export const formatOwnerVersions = (
  frameworks: readonly PluginFrameworkEntry[],
): Readonly<Record<string, string>> =>
  Object.fromEntries(frameworks.map((framework) => [framework.moduleName, framework.claim.contractVersion]))

export type StampedFileResult = schema.FileResult & Partial<FileFormatIdentity>

export const stampedFileResults = (
  files: schema.FileResultDictionary,
  formatIdentities: Readonly<Record<string, FileFormatIdentity>>,
): Readonly<Record<string, StampedFileResult>> =>
  Object.fromEntries(
    Object.entries(files).map(([reportName, file]): readonly [string, StampedFileResult] =>
      Option.match(Option.fromUndefinedOr(formatIdentities[reportName]), {
        onNone: (): readonly [string, StampedFileResult] => [reportName, file],
        onSome: (identity): readonly [string, StampedFileResult] => [reportName, { ...file, ...identity }],
      })
    ),
  )

export const reportFileName = (relativePath: string | undefined): string =>
  Option.match(Option.fromUndefinedOr(relativePath), {
    onNone: () => '',
    onSome: (present) => present.replaceAll('\\', '/'),
  })

export interface TestIdRemap {
  readonly testId: (id: string) => string
  readonly testIds: (ids: readonly string[] | undefined) => readonly string[] | undefined
}

export const testIdRemap = (testIds: readonly string[]): TestIdRemap => {
  const positions = HashMap.fromIterable(
    testIds.map((id, position): readonly [string, string] => [id, position.toString()]),
  )
  const remapId = (id: string): string => Option.getOrElse(HashMap.get(positions, id), () => id)
  const remapIds = (ids: readonly string[] | undefined): readonly string[] | undefined => {
    if (ids === undefined) {
      return undefined
    }
    return ids.map(remapId)
  }
  return { testId: remapId, testIds: remapIds }
}

export const toReportMutant = (mutant: RunMutantResult, remap: TestIdRemap): schema.MutantResult => ({
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

export const toReportTest = (test: TestResult, remap: TestIdRemap): schema.TestDefinition => {
  const base: schema.TestDefinition = { id: remap.testId(test.id), name: test.name }
  if (test.startPosition === undefined) {
    return base
  }
  return { ...base, location: { start: test.startPosition } }
}

interface MutantGroup {
  readonly sourceFileName: string
  readonly mutants: readonly schema.MutantResult[]
}

export interface FileResultsInput {
  readonly sources: HashMap.HashMap<string, schema.FileResult>
  readonly reportNames: HashMap.HashMap<string, string>
  readonly mutants: readonly RunMutantResult[]
  readonly remap: TestIdRemap
}

export const assembleFileResults = (input: FileResultsInput): schema.FileResultDictionary => {
  const grouped = input.mutants.reduce<HashMap.HashMap<string, MutantGroup>>(
    (accumulator, mutant) =>
      Option.match(HashMap.get(input.reportNames, mutant.fileName), {
        onNone: () => accumulator,
        onSome: (reportName) => {
          const mapped = toReportMutant(mutant, input.remap)
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
    HashMap.empty<string, MutantGroup>(),
  )

  const entries = [...grouped].flatMap(([reportName, group]) =>
    Option.match(HashMap.get(input.sources, group.sourceFileName), {
      onNone: (): ReadonlyArray<readonly [string, schema.FileResult]> => [],
      onSome: (source): ReadonlyArray<readonly [string, schema.FileResult]> => [
        [reportName, { ...source, mutants: group.mutants }],
      ],
    })
  )
  return Object.fromEntries(entries)
}

interface TestGroup {
  readonly sourceFileName: string
  readonly tests: readonly schema.TestDefinition[]
}

export interface TestFilesInput {
  readonly testSources: HashMap.HashMap<string, schema.TestFile>
  readonly reportNames: HashMap.HashMap<string, string>
  readonly tests: readonly TestResult[]
  readonly remap: TestIdRemap
}

export const assembleTestFiles = (input: TestFilesInput): schema.TestFileDefinitionDictionary => {
  const grouped = input.tests.reduce<HashMap.HashMap<string, TestGroup>>(
    (accumulator, test) =>
      Option.match(Option.fromUndefinedOr(test.fileName), {
        onNone: () => accumulator,
        onSome: (testFileName) =>
          Option.match(HashMap.get(input.reportNames, testFileName), {
            onNone: () => accumulator,
            onSome: (reportName) => {
              const mapped = toReportTest(test, input.remap)
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
    HashMap.empty<string, TestGroup>(),
  )

  const entries = [...grouped].flatMap(([reportName, group]) =>
    Option.match(HashMap.get(input.testSources, group.sourceFileName), {
      onNone: (): ReadonlyArray<readonly [string, schema.TestFile]> => [],
      onSome: (source): ReadonlyArray<readonly [string, schema.TestFile]> => [
        [reportName, { ...source, tests: group.tests }],
      ],
    })
  )
  return Object.fromEntries(entries)
}

if (import.meta.vitest) {
  const { it } = await import('@effect/vitest')
  const { FastCheck: fc } = await import('effect/testing')
  const { coreFormatRegistry } = await import('@systemfsoftware/stryker-js-instrumenter')
  const S = await import('effect/Schema')

  const claimedExtensions: readonly string[] = coreFormatRegistry.entries.flatMap((entry) => entry.claim.extensions)
  const ExtensionSchema = S.Union([S.Literals(claimedExtensions), S.String])
  const StampRequestSchema = S.Struct({ extension: ExtensionSchema, ownerVersion: S.optional(S.String) })

  it.prop(
    '∀r_FileStamp_=RegistryClaim',
    [S.toArbitrary(StampRequestSchema)(fc)],
    ([request]) => {
      const claim = coreFormatRegistry.entryForExtension(request.extension)
      const ownerVersions: Readonly<Record<string, string>> = Option.match(claim, {
        onNone: () => ({}),
        onSome: (entry) =>
          Option.match(Option.fromUndefinedOr(request.ownerVersion), {
            onNone: () => ({}),
            onSome: (version) => ({ [entry.owner]: version }),
          }),
      })
      const stamped = fileFormatIdentity(coreFormatRegistry, ownerVersions, `src/subject${request.extension}`)
      return Option.match(claim, {
        onNone: () => stamped === undefined,
        onSome: (entry) =>
          Option.match(Option.fromUndefinedOr(stamped), {
            onNone: () => false,
            onSome: (identity) =>
              [
                identity.formatId === entry.claim.formatId,
                identity.ownerModule === entry.owner,
                identity.ownerVersion === Option.getOrElse(Option.fromUndefinedOr(request.ownerVersion), () => ''),
              ].every((holds) => holds),
          }),
      })
    },
  )
}
