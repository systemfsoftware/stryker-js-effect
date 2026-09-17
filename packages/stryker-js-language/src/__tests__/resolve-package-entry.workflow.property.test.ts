import { describe, it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { FastCheck as fc } from 'effect/testing'

import {
  type EntryFile,
  EntryFileFromExports,
  EntryFileFromMain,
  type EntryRefusal,
  resolvePackageEntry,
  ResolvePackageEntryCommand,
} from '../resolve-package-entry.workflow.js'

const CONDITION_KEYS = ['import', 'node', 'default'] as const

const MAX_CONDITION_DEPTH = 32

const resolve = (manifest: unknown, subpath: string): Result.Result<EntryFile, EntryRefusal> =>
  resolvePackageEntry(new ResolvePackageEntryCommand({ manifest, subpath }))

const resolvesTo = (manifest: unknown, subpath: string, expected: string): boolean => {
  const result = resolve(manifest, subpath)
  return Result.isSuccess(result) && result.success.path === expected
}

const refuses = (manifest: unknown, subpath: string, expected: string): boolean => {
  const result = resolve(manifest, subpath)
  return Result.isFailure(result) && result.failure.reason === expected
}

const nestedConditions = (depth: number): unknown =>
  Array.from({ length: depth }).reduce<unknown>((inner) => ({ default: inner }), './index.js')

const cyclicConditions: Record<string, unknown> = {}
cyclicConditions['default'] = cyclicConditions

const VITEST_MANIFEST = {
  name: 'vitest',
  exports: {
    '.': { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/index.cjs' },
    './node': { import: { types: './dist/node.d.ts', default: './dist/node.js' } },
    './package.json': './package.json',
    './*': { import: './dist/*.js' },
  },
}

const relativeFilePath = fc.stringMatching(/^\.\/[a-z][a-z0-9-]{0,10}\.[a-z]{1,4}$/)

const subpathToken = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/)

const conditionOrder = fc.shuffledSubarray([...CONDITION_KEYS], { minLength: 1 })

const patternStyle = fc.constantFrom('pattern', 'exact', 'both')

const extensionlessBase = fc.oneof(
  fc.constant(''),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
  fc.stringMatching(/^\.[a-z]{0,4}$/),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,10}\.$/),
)

const nonRelativeTarget = fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9./-]{0,10}$/)

const unsupportedExportTarget = fc.oneof(
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string()),
  fc.dictionary(fc.constantFrom('types', 'require', 'browser'), fc.string()),
  nonRelativeTarget,
)

const manifestWithoutEntryFields = fc.oneof(
  fc.constant(null),
  fc.constant([]),
  fc.string(),
  fc.integer(),
  fc.dictionary(fc.constantFrom('name', 'version', 'type', 'private'), fc.string()),
)

const invalidManifests = fc.oneof(
  manifestWithoutEntryFields.map((manifest) => ({ manifest, subpath: '.', reason: 'no-main-no-exports' })),
  extensionlessBase.map((base) => ({
    manifest: { main: `./dist/${base}` },
    subpath: '.',
    reason: 'main-without-extension',
  })),
  unsupportedExportTarget.map((target) => ({
    manifest: { exports: { '.': target } },
    subpath: '.',
    reason: 'unsupported-exports-shape',
  })),
  subpathToken.map((token) => ({
    manifest: { exports: { './only-here': './only-here.js' } },
    subpath: `./${token}`,
    reason: 'unmatched-subpath',
  })),
)

const manifestsWithoutManifestSubpath = fc.oneof(
  fc.constant({}),
  extensionlessBase.map((base) => ({ main: `./dist/${base}.js` })),
  subpathToken.map((token) => ({ exports: { [`./${token}`]: `./${token}.js` } })),
)

describe('resolvePackageEntry', () => {
  it.prop('∀order_Conditions_≡ImportPriority', [conditionOrder], ([order]) => {
    const conditions = Object.fromEntries(order.map((key) => [key, `./${key}.js`]))
    const winner = CONDITION_KEYS.find((key) => key in conditions)
    return resolvesTo({ exports: { '.': { require: './require.cjs', ...conditions } } }, '.', `./${winner}.js`)
  })

  it.prop('∀path_StringExports_≡Entry', [relativeFilePath], ([path]) => {
    const result = resolve({ exports: { '.': path } }, '.')
    return Result.isSuccess(result) && S.is(EntryFileFromExports)(result.success) && result.success.path === path
  })

  it.prop('∀path_LegacyMain_≡Entry', [relativeFilePath], ([path]) => {
    const result = resolve({ main: path }, '.')
    return Result.isSuccess(result) && S.is(EntryFileFromMain)(result.success) && result.success.path === path
  })

  it.prop('∀subpath_Exports_≡ExactOrPattern', [subpathToken, patternStyle], ([token, style]) => {
    const subpath = `./${token}`
    const exact = `./exact/${token}.js`
    const isPattern = style === 'pattern'
    const exports = Match.value(isPattern).pipe(
      Match.when(true, () => ({ './*': './dist/*.js' })),
      Match.orElse(() => ({ './*': './dist/*.js', [subpath]: exact })),
    )
    return Match.value(isPattern).pipe(
      Match.when(true, () => resolvesTo({ exports }, subpath, `./dist/${token}.js`)),
      Match.orElse(() => resolvesTo({ exports }, subpath, exact)),
    )
  })

  it.prop(
    '∀subpath_EmptyManifest_≡ManifestOnly',
    [S.toArbitrary(S.String)(fc)],
    ([subpath]) =>
      Match.value(subpath).pipe(
        Match.when('./package.json', () => resolvesTo({}, subpath, './package.json')),
        Match.when('.', () => refuses({}, subpath, 'no-main-no-exports')),
        Match.orElse(() => refuses({}, subpath, 'unmatched-subpath')),
      ),
  )

  it.prop(
    '∀manifest_Invalid_≡Refuse',
    [invalidManifests],
    ([invalid]) => refuses(invalid.manifest, invalid.subpath, invalid.reason),
  )

  it.prop(
    '∀vitest_Manifest_≡ImportBranch',
    [fc.constant(VITEST_MANIFEST)],
    ([manifest]) =>
      resolvesTo(manifest, '.', './dist/index.js') &&
      resolvesTo(manifest, './node', './dist/node.js') &&
      resolvesTo(manifest, './package.json', './package.json') &&
      resolvesTo(manifest, './utils', './dist/utils.js'),
  )

  it.prop(
    '∀manifest_ManifestSubpath_≡ManifestFile',
    [manifestsWithoutManifestSubpath],
    ([manifest]) => resolvesTo(manifest, './package.json', './package.json'),
  )

  it.prop(
    '∀path_ManifestSubpath_≡Exact',
    [relativeFilePath],
    ([path]) => resolvesTo({ exports: { './package.json': path } }, './package.json', path),
  )

  it.prop('∀depth_Conditions_≡Budget', [fc.integer({ min: 1, max: 40 })], ([depth]) => {
    const result = resolve({ exports: { '.': nestedConditions(depth) } }, '.')
    return Match.value(depth <= MAX_CONDITION_DEPTH).pipe(
      Match.when(true, () => Result.isSuccess(result) && result.success.path === './index.js'),
      Match.orElse(() => Result.isFailure(result) && result.failure.reason === 'unsupported-exports-shape'),
    )
  })

  it.prop(
    '∀cyclic_Conditions_≡Refuse',
    [fc.constant({ exports: { '.': cyclicConditions } })],
    ([manifest]) => refuses(manifest, '.', 'unsupported-exports-shape'),
  )
})
