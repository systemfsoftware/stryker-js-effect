import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type ManifestTarget,
  ManifestTargetCommand,
  PackageExportRequest,
  PackageImportRequest,
  PackageManifestSchema,
} from '../import-closure.schema.js'
import { selectManifestTarget } from '../select-manifest-target.workflow.js'

type SelectSubject = (command: ManifestTargetCommand) => Result.Result<ManifestTarget, never>

const INVALID_SEGMENTS: readonly string[] = ['.', '..', 'node_modules', 'Node_Modules']

const SOURCE_CONDITION = '@systemfsoftware/source'

const textOf = (command: ManifestTargetCommand): string =>
  Match.value(command.request).pipe(
    Match.tagsExhaustive({
      PackageExportRequest: ({ subpath }) => subpath,
      PackageImportRequest: ({ specifier }) => specifier,
    }),
  )

const oneSegmentOf = (command: ManifestTargetCommand): string => textOf(command).replaceAll(/[/\\]/g, '')

const exportKeyOf = (subpath: string): string => (subpath.length === 0 ? '.' : `./${subpath}`)

type ManifestWire = typeof PackageManifestSchema.Encoded

const wireOf = (command: ManifestTargetCommand): ManifestWire =>
  Result.getOrThrow(S.encodeResult(PackageManifestSchema)(command.manifest))

const selected = (
  subject: SelectSubject,
  wire: ManifestWire,
  request: PackageExportRequest | PackageImportRequest,
): string =>
  Result.match(
    Result.flatMap(
      S.decodeResult(PackageManifestSchema)(wire),
      (manifest) => subject(ManifestTargetCommand.make({ manifest, request })),
    ),
    {
      onFailure: () => 'refused',
      onSuccess: (target) =>
        Match.value(target).pipe(
          Match.tagsExhaustive({
            ManifestPathTarget: ({ target: path }) => `path:${path}`,
            ManifestPackageTarget: ({ specifier }) => `package:${specifier}`,
            ManifestTargetMissing: () => 'missing',
          }),
        ),
    },
  )

const exported = (
  subject: SelectSubject,
  command: ManifestTargetCommand,
  exports: S.Json,
  subpath: string,
) => selected(subject, { ...wireOf(command), exports }, PackageExportRequest.make({ subpath }))

const ROOT_REQUEST = PackageExportRequest.make({ subpath: '' })

const RUNTIME_CONDITIONS: ReadonlyArray<string> = ['import', 'node', 'default']

const runtimeConditionAt = (depth: number): string => RUNTIME_CONDITIONS[depth % RUNTIME_CONDITIONS.length] ?? 'default'

const nestedUnder = (keys: ReadonlyArray<string>, innermost: S.Json): S.Json =>
  keys.reduceRight<S.Json>(
    (inner, _key, depth) => ({
      types: './index.d.ts',
      [`types@>=${depth}`]: './versioned.d.ts',
      [runtimeConditionAt(depth)]: inner,
      browser: './later.js',
    }),
    innermost,
  )

const COMMONJS_SIBLINGS: ReadonlyArray<string> = ['require', 'module-sync', 'node', 'default']

const commonJsSiblingOf = (command: ManifestTargetCommand): string =>
  COMMONJS_SIBLINGS[textOf(command).length % COMMONJS_SIBLINGS.length] ?? 'require'

const SHARED_CONDITIONS: ReadonlyArray<string> = ['node', 'default']

const sharedUnder = (keys: ReadonlyArray<string>, innermost: S.Json): S.Json =>
  keys.reduceRight<S.Json>(
    (inner, _key, depth) => ({
      types: './index.d.ts',
      [SHARED_CONDITIONS[depth % SHARED_CONDITIONS.length] ?? 'default']: inner,
      browser: './later.js',
    }),
    innermost,
  )

const UNMATCHED_CONDITIONS: ReadonlyArray<string> = ['browser', 'module', 'development', 'production']

const unmatchedConditionOf = (command: ManifestTargetCommand): string =>
  [
    ...UNMATCHED_CONDITIONS,
    `c${oneSegmentOf(command)}`,
  ][textOf(command).length % (UNMATCHED_CONDITIONS.length + 1)] ??
    'browser'

const targetOf = (command: ManifestTargetCommand): string => `./${oneSegmentOf(command)}x.ts`

const keysOf = (command: ManifestTargetCommand): ReadonlyArray<string> => ['outer', ...textOf(command).split('/')]

const manifestExportsOf = (command: ManifestTargetCommand): S.Json => wireOf(command).exports ?? null

const imported = (subject: SelectSubject, command: ManifestTargetCommand, imports: S.Json, specifier: string) =>
  selected(subject, { ...wireOf(command), imports }, PackageImportRequest.make({ specifier }))

describe('selectManifestTarget', () => {
  it.prop(
    '∀c_ExportConditions_≡SourceConditionBeforeEarlierConditions',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const subpath = textOf(command)
      const conditions = { default: './default.js', [SOURCE_CONDITION]: './source.ts' }
      return exported(subject, command, { [exportKeyOf(subpath)]: conditions }, subpath) === 'path:./source.ts'
    },
  )

  it.prop(
    '∀c_ExportSubpath_≡ExactKeyBeforeWildcardWhichSubstitutesTheSubpath',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const subpath = `x$&${oneSegmentOf(command)}`
      return [
        exported(subject, command, { './*': './wild/*', [`./${subpath}`]: './exact.js' }, subpath),
        exported(subject, command, { './*': './wild/*' }, subpath),
      ].join('|') === `path:./exact.js|path:./wild/${subpath}`
    },
  )

  it.prop(
    '∀c_ExportPatterns_≡LongestPrefixBeatsTheRootWildcardInEitherKeyOrder',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const captured = `$&${oneSegmentOf(command)}x`
      const subpath = `features/${captured}`
      return [
        exported(subject, command, { './*': './wild/*', './features/*': './feat/*.js' }, subpath),
        exported(subject, command, { './features/*': './feat/*.js', './*': './wild/*' }, subpath),
      ].every((target) => target === `path:./feat/${captured}.js`)
    },
  )

  it.prop(
    '∀c_ExportPattern_≡AnyPatternKeyResolvesWithoutTheRootWildcard',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const captured = `${oneSegmentOf(command)}x`
      return [
        exported(subject, command, { './features/*.js': './feat/*.ts' }, `features/${captured}.js`),
        exported(subject, command, { './features/*.js': './feat/*.ts' }, `other/${captured}.js`),
      ].join('|') === `path:./feat/${captured}.ts|missing`
    },
  )

  it.prop(
    '∀c_MapTarget_≡MissingWhenASegmentAfterTheLeadingDotSlashIsDotDotDotOrNodeModules',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const subpath = `x${oneSegmentOf(command)}`
      const specifier = `#${subpath}`
      const outcomes = INVALID_SEGMENTS.flatMap((segment) => [
        exported(subject, command, { [`./${subpath}`]: `./a/${segment}/b.js` }, subpath),
        exported(subject, command, { './*': './src/*' }, `${segment}/${subpath}`),
        imported(subject, command, { [specifier]: `./a/${segment}/b.js` }, specifier),
        imported(subject, command, { '#*': './src/*' }, `#${segment}/${subpath}`),
      ])
      return [
        outcomes.every((outcome) => outcome === 'missing'),
        exported(subject, command, { [`./${subpath}`]: './a/b.js' }, subpath) === 'path:./a/b.js',
        imported(subject, command, { [specifier]: './a/b.js' }, specifier) === 'path:./a/b.js',
      ].every((holds) => holds)
    },
  )

  it.prop(
    '∀c_RootExports_≡StringOrArrayRootServesTheRootOnlyWhateverMainAndModuleSay',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const target = targetOf(command)
      const subpath = `x${textOf(command)}`
      return [
        exported(subject, command, target, ''),
        exported(subject, command, target, subpath),
        exported(subject, command, [target], ''),
        exported(subject, command, [target], subpath),
      ].join('|') === `path:${target}|missing|path:${target}|missing`
    },
  )

  it.prop(
    '∀c_ImportSpecifier_≡ExactKeyBeforeAnyPattern',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const specifier = `#${textOf(command)}`
      return imported(subject, command, { '#*': './any/*', [specifier]: './exact.ts' }, specifier) === 'path:./exact.ts'
    },
  )

  it.prop(
    '∀c_ImportPatterns_≡LongestPrefixWinsInEitherKeyOrderAndSubstitutesTheCapture',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const captured = `$&${oneSegmentOf(command)}x`
      const specifier = `#a/${captured}`
      return [
        imported(subject, command, { '#*': './short/*', '#a/*': './long/*' }, specifier),
        imported(subject, command, { '#a/*': './long/*', '#*': './short/*' }, specifier),
      ].every((target) => target === `path:./long/${captured}`)
    },
  )

  it.prop(
    '∀c_ImportConditions_≡SourceConditionBeforeEarlierConditions',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const specifier = `#${textOf(command)}`
      const conditions = { default: './default.js', [SOURCE_CONDITION]: './source.ts' }
      return imported(subject, command, { [specifier]: conditions }, specifier) === 'path:./source.ts'
    },
  )

  it.prop(
    '∀c_ImportTarget_≡PackageWhenBareMissingWhenNotPackageRelative',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const specifier = `#${textOf(command)}`
      return [
        imported(subject, command, { [specifier]: `dep${textOf(command)}` }, specifier),
        ...['', '../up.js', '/abs.js', '#other'].map((target) =>
          imported(subject, command, { [specifier]: target }, specifier)
        ),
      ].join('|') === `package:dep${textOf(command)}|missing|missing|missing|missing`
    },
  )

  it.prop(
    '∀c_ManifestWithoutImports_≡EveryImportMissingWhateverItsExports',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const { imports: _dropped, ...withoutImports } = wireOf(command)
      return selected(subject, withoutImports, PackageImportRequest.make({ specifier: `#${textOf(command)}` })) ===
        'missing'
    },
  )

  it.prop(
    '∀c_ConditionChain_≡FirstRuntimeConditionPastTypesAtEveryDepthForExportsAndImports',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const target = targetOf(command)
      const subpath = `x${oneSegmentOf(command)}`
      const specifier = `#${subpath}`
      const nested = nestedUnder(keysOf(command), target)
      return [
        exported(subject, command, { [exportKeyOf(subpath)]: nested }, subpath),
        imported(subject, command, { [specifier]: nested }, specifier),
      ].every((outcome) => outcome === `path:${target}`)
    },
  )

  it.prop(
    '∀c_ConditionChain_≡UnmatchedConditionsFallThroughToTheFileEveryImporterLoads',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const target = targetOf(command)
      const subpath = `x${oneSegmentOf(command)}`
      const specifier = `#${subpath}`
      const keys = keysOf(command)
      const fallsThrough = sharedUnder(keys, {
        types: './index.d.ts',
        [unmatchedConditionOf(command)]: './other.js',
        default: target,
      })
      const typesOnly = sharedUnder(keys, { types: target, [`types@>=${textOf(command).length}`]: target })
      const scalarFirst = sharedUnder(keys, { types: './index.d.ts', node: textOf(command).length, default: target })
      return [
        exported(subject, command, { [exportKeyOf(subpath)]: fallsThrough }, subpath) === `path:${target}`,
        imported(subject, command, { [specifier]: fallsThrough }, specifier) === `path:${target}`,
        exported(subject, command, { [exportKeyOf(subpath)]: typesOnly }, subpath) === 'missing',
        imported(subject, command, { [specifier]: typesOnly }, specifier) === 'missing',
        exported(subject, command, { [exportKeyOf(subpath)]: scalarFirst }, subpath) === 'missing',
        imported(subject, command, { [specifier]: scalarFirst }, specifier) === 'missing',
      ].every((holds) => holds)
    },
  )

  it.prop(
    '∀c_ConditionChain_≡MissingWhenEsmAndCommonJsImportersLoadDifferentFiles',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const target = targetOf(command)
      const subpath = `x${oneSegmentOf(command)}`
      const specifier = `#${subpath}`
      const keys = keysOf(command)
      const dual = sharedUnder(keys, {
        types: './index.d.ts',
        import: target,
        [commonJsSiblingOf(command)]: './other.cjs',
      })
      const requireFirst = sharedUnder(keys, { types: './index.d.ts', require: './other.cjs', import: target })
      const esmOnly = sharedUnder(keys, {
        types: './index.d.ts',
        import: target,
        [unmatchedConditionOf(command)]: './other.js',
      })
      return [
        exported(subject, command, { [exportKeyOf(subpath)]: dual }, subpath) === 'missing',
        imported(subject, command, { [specifier]: dual }, specifier) === 'missing',
        exported(subject, command, { [exportKeyOf(subpath)]: requireFirst }, subpath) === 'missing',
        imported(subject, command, { [specifier]: requireFirst }, specifier) === 'missing',
        exported(subject, command, { [exportKeyOf(subpath)]: esmOnly }, subpath) === `path:${target}`,
        imported(subject, command, { [specifier]: esmOnly }, specifier) === `path:${target}`,
      ].every((holds) => holds)
    },
  )

  it.prop(
    '∀c_RootConditions_≡ReadAsTheRootEntryAndMissingBesideASubpathKey',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const target = targetOf(command)
      const conditions = nestedUnder(keysOf(command), target)
      const subpath = `x${oneSegmentOf(command)}`
      return [
        exported(subject, command, conditions, '') === `path:${target}`,
        exported(subject, command, conditions, subpath) === 'missing',
        exported(subject, command, { import: conditions, [exportKeyOf(subpath)]: target }, '') === 'missing',
      ].every((holds) => holds)
    },
  )

  it.prop(
    '∀c_ConditionChain_≡SourceConditionBeforeEarlierKeysAtItsOwnDepth',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const subpath = `x${oneSegmentOf(command)}`
      const conditions = { default: './default.js', [SOURCE_CONDITION]: './source.ts' }
      return exported(
        subject,
        command,
        { [exportKeyOf(subpath)]: nestedUnder(keysOf(command), conditions) },
        subpath,
      ) ===
        'path:./source.ts'
    },
  )

  it.prop(
    '∀c_Fallbacks_≡FirstElementYieldingAFileWinsAndOnlyAllUnmatchedElementsFallThrough',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const later = targetOf(command)
      const head = `./h${oneSegmentOf(command)}.js`
      const subpath = `x${oneSegmentOf(command)}`
      const key = exportKeyOf(subpath)
      const specifier = `#${subpath}`
      const unmatchedHead = { [unmatchedConditionOf(command)]: head }
      const scalarHead = textOf(command).length
      const allUnmatched = { node: [unmatchedHead], default: later }
      const blockedBeforeUnmatched = { node: [null, unmatchedHead], default: later }
      return [
        exported(subject, command, { [key]: [head, later] }, subpath) === `path:${head}`,
        imported(subject, command, { [specifier]: [head, later] }, specifier) === `path:${head}`,
        exported(subject, command, { [key]: [null, later] }, subpath) === `path:${later}`,
        imported(subject, command, { [specifier]: [null, later] }, specifier) === `path:${later}`,
        exported(subject, command, { [key]: [unmatchedHead, later] }, subpath) === `path:${later}`,
        imported(subject, command, { [specifier]: [unmatchedHead, later] }, specifier) === `path:${later}`,
        exported(subject, command, { [key]: [scalarHead, later] }, subpath) === `path:${later}`,
        imported(subject, command, { [specifier]: [scalarHead, later] }, specifier) === `path:${later}`,
        exported(subject, command, { [key]: [] }, subpath) === 'missing',
        imported(subject, command, { [specifier]: [] }, specifier) === 'missing',
        exported(subject, command, { [key]: [null] }, subpath) === 'missing',
        imported(subject, command, { [specifier]: [null] }, specifier) === 'missing',
        exported(subject, command, { [key]: allUnmatched }, subpath) === `path:${later}`,
        imported(subject, command, { [specifier]: allUnmatched }, specifier) === `path:${later}`,
        exported(subject, command, { [key]: blockedBeforeUnmatched }, subpath) === 'missing',
        imported(subject, command, { [specifier]: blockedBeforeUnmatched }, specifier) === 'missing',
      ].every((holds) => holds)
    },
  )

  it.prop(
    '∀c_StringTargets_≡AnInvalidTargetYieldsNoneAloneAndIsSkippedInsideAnArray',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const later = targetOf(command)
      const subpath = `x${oneSegmentOf(command)}`
      const key = exportKeyOf(subpath)
      const specifier = `#${subpath}`
      const bare = `${oneSegmentOf(command)}x.js`
      const escaping = `./${oneSegmentOf(command)}/../x.js`
      const absolute = `/${oneSegmentOf(command)}x.js`
      return [
        exported(subject, command, { [key]: bare }, subpath) === 'missing',
        exported(subject, command, { [key]: [bare, later] }, subpath) === `path:${later}`,
        exported(subject, command, { [key]: escaping }, subpath) === 'missing',
        exported(subject, command, { [key]: [escaping, later] }, subpath) === `path:${later}`,
        exported(subject, command, { [key]: absolute }, subpath) === 'missing',
        exported(subject, command, { [key]: [absolute, later] }, subpath) === `path:${later}`,
        imported(subject, command, { [specifier]: escaping }, specifier) === 'missing',
        imported(subject, command, { [specifier]: [escaping, later] }, specifier) === `path:${later}`,
        imported(subject, command, { [specifier]: absolute }, specifier) === 'missing',
        imported(subject, command, { [specifier]: [absolute, later] }, specifier) === `path:${later}`,
      ].every((holds) => holds)
    },
  )

  it.prop(
    '∀c_RootEntry_≡MainDecidesTheRootOnlyWhenExportsDeclaresNone',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const entry = manifestExportsOf(command)
      const main = targetOf(command)
      const rootOf = (manifest: ManifestWire) => selected(subject, manifest, ROOT_REQUEST)
      const declared = { imports: wireOf(command).imports ?? null, exports: { '.': entry } }
      return [
        rootOf({ ...declared, main }) === rootOf(declared),
        rootOf({ ...declared, exports: { './feature': entry }, main }) === `path:${main}`,
      ].every((holds) => holds)
    },
  )

  it.prop(
    '∀c_NullExports_≡ReadAsIfExportsWereAbsent',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const { exports: _dropped, ...withoutExports } = wireOf(command)
      return selected(subject, { ...withoutExports, exports: null }, command.request) ===
        selected(subject, withoutExports, command.request)
    },
  )

  it.prop(
    '∀c_ExactEntry_≡DecidesAloneWhateverPatternSitsBesideIt',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const entry = manifestExportsOf(command)
      const subpath = `x${oneSegmentOf(command)}`
      const specifier = `#${subpath}`
      return [
        exported(subject, command, { './*': './wild/*', [`./${subpath}`]: entry }, subpath) ===
          exported(subject, command, { [`./${subpath}`]: entry }, subpath),
        imported(subject, command, { '#*': './any/*', [specifier]: entry }, specifier) ===
          imported(subject, command, { [specifier]: entry }, specifier),
      ].every((holds) => holds)
    },
  )

  it.prop(
    '∀c_ConditionObject_≡AnArrayIndexKeyRefusesTheEntryEvenInsideAnArray',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const target = targetOf(command)
      const other = `./o${oneSegmentOf(command)}.js`
      const subpath = `x${oneSegmentOf(command)}`
      const key = exportKeyOf(subpath)
      const specifier = `#${subpath}`
      const indexed = { [`${textOf(command).length}`]: other, default: target }
      const nested = { node: indexed, default: target }
      const leading = [indexed, target]
      return [
        exported(subject, command, { [key]: indexed }, subpath) === 'missing',
        imported(subject, command, { [specifier]: indexed }, specifier) === 'missing',
        exported(subject, command, { [key]: nested }, subpath) === 'missing',
        imported(subject, command, { [specifier]: nested }, specifier) === 'missing',
        exported(subject, command, { [key]: leading }, subpath) === 'missing',
        imported(subject, command, { [specifier]: leading }, specifier) === 'missing',
      ].every((holds) => holds)
    },
  )

  it.prop(
    '∀c_MainOrModule_≡ANonStringMainYieldsNoneAndModuleCountsOnlyWithoutMain',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const { exports: _exports, main: _main, module: _module, ...rest } = wireOf(command)
      const target = targetOf(command)
      const other = `./o${oneSegmentOf(command)}.js`
      const unreadable = textOf(command).length
      const nonStringMains: ReadonlyArray<S.Json> = [unreadable, true, null, [target], { default: target }]
      const root = (fields: Readonly<Record<string, S.Json>>) => selected(subject, { ...rest, ...fields }, ROOT_REQUEST)
      return [
        ...nonStringMains.map((main) => root({ main, module: other }) === 'missing'),
        root({ module: target }) === `path:${target}`,
        root({ main: target, module: other }) === `path:${target}`,
        root({ module: unreadable }) === 'missing',
      ].every((holds) => holds)
    },
  )
})
