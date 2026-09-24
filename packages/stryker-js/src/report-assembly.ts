/// <reference types="vitest/importMeta" />
import type { Framework } from '@systemfsoftware/stryker-framework-interface'
import type { FormatRegistry, RunMutantResult } from '@systemfsoftware/stryker-js-instrumenter'
import type * as schema from '@systemfsoftware/stryker-js-plugin-interface'
import type { TestResult } from '@systemfsoftware/stryker-js-plugin-interface'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import type { FormatIdentity } from './IncrementalDiff.schema.js'

const extensionOf = (fileName: string): string => {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return ''
  }
  return base.slice(dot).toLowerCase()
}

const UNCLAIMED_LANGUAGE = 'javascript'

export const determineLanguage = (fileName: string, registry: FormatRegistry): string =>
  Option.match(registry.entryForExtension(extensionOf(fileName)), {
    onNone: () => UNCLAIMED_LANGUAGE,
    onSome: (entry) => entry.claim.language,
  })

export const identityOf = (fileName: string, registry: FormatRegistry): Option.Option<FormatIdentity> =>
  Option.map(registry.entryForExtension(extensionOf(fileName)), (entry) => ({
    formatId: entry.claim.formatId,
    ownerModule: entry.owner,
    ownerVersion: entry.ownerVersion,
  }))

export type FileResultWithIdentity = schema.FileResult & { readonly formatIdentity?: FormatIdentity }

export const stampFileIdentities = (
  files: schema.FileResultDictionary,
  identities: HashMap.HashMap<string, Option.Option<FormatIdentity>>,
): Record<string, FileResultWithIdentity> =>
  Object.fromEntries(
    Object.entries(files).map(([name, file]): readonly [string, FileResultWithIdentity] => [
      name,
      Option.match(Option.flatMap(HashMap.get(identities, name), (present) => present), {
        onNone: () => file,
        onSome: (identity) => ({ ...file, formatIdentity: identity }),
      }),
    ]),
  )

export const reportFileName = (relativePath: string | undefined): string =>
  Option.match(Option.fromUndefinedOr(relativePath), {
    onNone: () => '',
    onSome: (present) => present.replaceAll('\\', '/'),
  })

if (import.meta.vitest !== undefined) {
  const { it } = await import('@effect/vitest')
  const { FormatIdentitySchema } = await import('./IncrementalDiff.schema.js')
  const { coreFormatRegistry, frameworkEntryOf, registerEntries } = await import(
    '@systemfsoftware/stryker-js-instrumenter'
  )

  const constantFrom = <Item = unknown, const A extends readonly [Item, ...Item[]] = readonly [Item, ...Item[]]>(
    ...values: A
  ): Arbitrary.Arbitrary<A[number]> =>
    Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: values.length - 1 }))).pipe(
      Arbitrary.flatMap((index) => {
        const chosen = values[index]
        if (chosen === undefined) {
          throw new Error(`constantFrom was asked for a value at index ${index}, which is unbound`)
        }
        return Arbitrary.Constant(chosen)
      }),
    )

  const CORE_OWNER = '@systemfsoftware/stryker-js-instrumenter'
  const CORE_OWNER_VERSION = 'builtin'

  const BUILTIN_LABELS = [
    { extension: '.ts', language: 'typescript' },
    { extension: '.tsx', language: 'typescript' },
    { extension: '.mts', language: 'typescript' },
    { extension: '.cts', language: 'typescript' },
    { extension: '.js', language: 'javascript' },
    { extension: '.jsx', language: 'javascript' },
    { extension: '.mjs', language: 'javascript' },
    { extension: '.cjs', language: 'javascript' },
  ] as const

  const CORE_IDENTITIES = [
    { extension: '.ts', formatId: 'ts' },
    { extension: '.tsx', formatId: 'tsx' },
    { extension: '.js', formatId: 'js' },
    { extension: '.mts', formatId: 'ts' },
  ] as const

  const SVELTE_FIXTURE: Framework = {
    kind: 'Framework',
    name: 'svelte-fixture',
    claim: {
      formatId: 'svelte',
      extensions: ['.svelte'],
      language: 'svelte',
      ownerVersion: '1.0.0',
      contractVersion: '1',
    },
    parse: (rawContent) => ({ kind: 'Parsed', value: { formatId: 'svelte', rawContent, regions: [] } }),
    transform: (document) => document,
    print: (document) => document.rawContent,
    disableTypeChecks: (rawContent) => ({ kind: 'Parsed', value: rawContent }),
  }

  const registryWithSvelte = registerEntries(coreFormatRegistry, [frameworkEntryOf('fixture-svelte', SVELTE_FIXTURE)])

  const at = <File, Field>(file: File | undefined, pick: (present: File) => Field): Field | undefined =>
    file === undefined ? undefined : pick(file)

  const identityField = (
    identity: FormatIdentity | undefined,
    field: 'formatId' | 'ownerModule' | 'ownerVersion',
  ): string | undefined => identity?.[field]

  it.prop('∀name_ExtensionOf_∈SuffixLiterals', [
    constantFrom('src/app.ts', 'src/App.TS', 'README', 'src/x.tar.gz'),
  ], ([name]) => {
    const expected = { 'src/app.ts': '.ts', 'src/App.TS': '.ts', README: '', 'src/x.tar.gz': '.gz' }[name]
    return extensionOf(name) === expected
  })

  it.prop(
    '∀ext_BuiltInLabel_≡MainBytes',
    [constantFrom(...BUILTIN_LABELS)],
    ([row]) =>
      [[determineLanguage(`src/app${row.extension}`, coreFormatRegistry), row.language]].every(([actual, expected]) =>
        actual === expected
      ),
  )

  it.prop(
    '∀name_UnclaimedExtension_≡Javascript',
    [
      constantFrom('src/app.svelte', 'src/app.html', 'src/app.vue', 'src/app.rb', 'src/README'),
    ],
    ([name]) =>
      [[determineLanguage(name, coreFormatRegistry), 'javascript']].every(([actual, expected]) => actual === expected),
  )

  it.prop(
    '∀name_SvelteClaim_≡Svelte',
    [constantFrom('src/App.svelte', 'src/routes/Page.svelte')],
    ([name]) =>
      [[determineLanguage(name, registryWithSvelte), 'svelte']].every(([actual, expected]) => actual === expected),
  )

  it.prop('∀ext_CoreIdentity_∈Literals', [constantFrom(...CORE_IDENTITIES)], ([row]) => {
    const identity = Option.getOrUndefined(identityOf(`src/app${row.extension}`, coreFormatRegistry))
    return [
      [identityField(identity, 'formatId'), row.formatId],
      [identityField(identity, 'ownerModule'), CORE_OWNER],
      [identityField(identity, 'ownerVersion'), CORE_OWNER_VERSION],
    ].every(([actual, expected]) => actual === expected)
  })

  it.prop(
    '∀name_SvelteIdentity_∈FixtureLiterals',
    [constantFrom('src/App.svelte', 'src/routes/Page.svelte')],
    ([name]) => {
      const identity = Option.getOrUndefined(identityOf(name, registryWithSvelte))
      return [
        [identityField(identity, 'formatId'), 'svelte'],
        [identityField(identity, 'ownerModule'), 'fixture-svelte'],
        [identityField(identity, 'ownerVersion'), '1.0.0'],
      ].every(([actual, expected]) => actual === expected)
    },
  )

  it.prop(
    '∀name_UnclaimedIdentity_∈None',
    [constantFrom('src/app.html', 'src/README')],
    ([name]) =>
      [[identityField(Option.getOrUndefined(identityOf(name, coreFormatRegistry)), 'formatId'), undefined]].every((
        [actual, expected],
      ) => actual === expected),
  )

  it.prop('∀i_Stamp_≡ClaimPlacement', [FormatIdentitySchema], ([identity]) => {
    const files = {
      'a.ts': { language: 'typescript', source: 'a', mutants: [] },
      'b.rb': { language: 'javascript', source: 'b', mutants: [] },
      'c.js': { language: 'javascript', source: 'c', mutants: [] },
    }
    const identities: HashMap.HashMap<string, Option.Option<FormatIdentity>> = HashMap.fromIterable([
      ['a.ts', Option.some(identity)],
      ['b.rb', Option.none()],
    ])
    const stamped = stampFileIdentities(files, identities)
    const tsFile = stamped['a.ts']
    const rbFile = stamped['b.rb']
    const jsFile = stamped['c.js']
    return [
      [Object.keys(stamped).length, 3],
      [at(tsFile, (file) => file.formatIdentity?.formatId), identity.formatId],
      [at(tsFile, (file) => file.formatIdentity?.ownerModule), identity.ownerModule],
      [at(tsFile, (file) => file.formatIdentity?.ownerVersion), identity.ownerVersion],
      [at(tsFile, (file) => file.language), 'typescript'],
      [at(tsFile, (file) => file.source), 'a'],
      [at(tsFile, (file) => file.mutants.length), 0],
      [at(rbFile, (file) => file.formatIdentity), undefined],
      [at(rbFile, (file) => file.language), 'javascript'],
      [at(rbFile, (file) => file.source), 'b'],
      [at(jsFile, (file) => file.formatIdentity), undefined],
      [at(jsFile, (file) => file.language), 'javascript'],
      [at(jsFile, (file) => file.source), 'c'],
    ].every(([actual, expected]) => actual === expected)
  })
}

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
