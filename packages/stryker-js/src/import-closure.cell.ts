import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { classifyModuleSpecifier } from './classify-module-specifier.workflow.js'
import { extractModuleSpecifiers } from './extract-module-specifiers.workflow.js'
import { relativeNormalizedFileName } from './FileMatcher.js'
import {
  ClassifyModuleSpecifierCommand,
  ExtractModuleSpecifiersCommand,
  ImportClosureCommand,
  type ImportClosureModule,
  type ManifestTarget,
  ManifestTargetCommand,
  ManifestTargetMissing,
  type ModuleSpecifierKind,
  ModuleSpecifiersOpen,
  PackageExportRequest,
  PackageImportRequest,
  type PackageManifest,
  PackageManifestSchema,
  type PackageSpecifier,
  type ScriptLanguage,
  type TestFileClosure,
} from './import-closure.schema.js'
import { importClosure } from './import-closure.workflow.js'
import { selectManifestTarget } from './select-manifest-target.workflow.js'
import { SourceParser } from './source-parser.service.js'
import { packageManifestInputOf } from './verdict-semantics.js'

export interface ImportClosureInput {
  readonly rootDir: string
  readonly projectFiles: readonly string[]
  readonly testFiles: readonly string[]
  readonly globalInputs?: readonly string[]
  readonly observedModules?: Readonly<Record<string, readonly string[]>>
}

export interface TestFileClosureDigest {
  readonly testFile: string
  readonly files: readonly string[]
  readonly open: boolean
  readonly digest: string
}

export interface ImportClosureAnalysis {
  readonly closures: readonly TestFileClosureDigest[]
  readonly projectDigest: string
}

interface Roots {
  readonly rootDir: string
  readonly realRoot: string
}

interface LoadedFile {
  readonly key: string
  readonly absolute: string
  readonly content: string
}

interface ModuleScan {
  readonly key: string
  readonly contentHash: string
  readonly dependencies: readonly string[]
  readonly open: boolean
  readonly dynamicOpen: boolean
}

type OpenMode = 'Combined' | 'Structural'

interface ObservedEvidence {
  readonly roots: readonly string[]
  readonly invalid: boolean
}

interface Resolution {
  readonly kind: 'Member' | 'External' | 'Unresolved'
  readonly file: string
}

interface ResolveInput {
  readonly files: HashSet.HashSet<string>
  readonly realRoot: string
  readonly key: string
  readonly absolute: string
  readonly specifier: string
}

const CONCURRENCY = 24

const PACKAGE_MANIFEST_FILE = 'package.json'

const BUILTIN_MODULES: readonly string[] = globalThis.process.getBuiltinModule('node:module').builtinModules

const SCRIPT_LANGUAGES: Readonly<Record<string, ScriptLanguage>> = {
  '.cjs': 'js',
  '.cts': 'ts',
  '.js': 'js',
  '.jsx': 'jsx',
  '.mjs': 'js',
  '.mts': 'ts',
  '.ts': 'ts',
  '.tsx': 'tsx',
}

const INERT_EXTENSIONS: Readonly<Record<string, true>> = {
  '.avif': true,
  '.css': true,
  '.csv': true,
  '.eot': true,
  '.gif': true,
  '.ico': true,
  '.jpeg': true,
  '.jpg': true,
  '.json': true,
  '.jsonc': true,
  '.less': true,
  '.map': true,
  '.md': true,
  '.node': true,
  '.png': true,
  '.sass': true,
  '.scss': true,
  '.snap': true,
  '.svg': true,
  '.toml': true,
  '.ttf': true,
  '.txt': true,
  '.wasm': true,
  '.webp': true,
  '.woff': true,
  '.woff2': true,
  '.yaml': true,
  '.yml': true,
}

const EXTENSION_ORDER: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

const EXTENSION_SWAPS: Readonly<Record<string, readonly string[]>> = {
  '.cjs': ['.cts'],
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
}

const EXTERNAL_RESOLUTION: Resolution = { kind: 'External', file: '' }
const UNRESOLVED_RESOLUTION: Resolution = { kind: 'Unresolved', file: '' }

const hashOf = (content: string): string => bytesToHex(sha256(utf8ToBytes(content)))

const scanSource = Effect.fnUntraced(function*(content: string, absolute: string, language: ScriptLanguage) {
  const parser = yield* SourceParser
  const parsed = yield* parser.parseSource(absolute, content, language)
  const extracted = Result.getOrElse(
    extractModuleSpecifiers(ExtractModuleSpecifiersCommand.make({ program: parsed.program })),
    (unreachable: never) => unreachable,
  )
  return {
    specifiers: extracted.specifiers,
    dynamicOpen: S.is(ModuleSpecifiersOpen)(extracted),
    parseFailed: parsed.parseFailed,
  }
})

const extensionOf = (file: string): string => {
  const dot = file.lastIndexOf('.')
  return dot > file.lastIndexOf('/') ? file.slice(dot) : ''
}

const replaceExtension = (file: string, extension: string): string => {
  const current = extensionOf(file)
  return `${file.slice(0, file.length - current.length)}${extension}`
}

const swappedExtensions = (extension: string): readonly string[] => EXTENSION_SWAPS[extension] ?? []

const swappedCandidates = (specifier: string): readonly string[] =>
  swappedExtensions(extensionOf(specifier)).map((extension) => replaceExtension(specifier, extension))

const appendedCandidates = (specifier: string): readonly string[] =>
  extensionOf(specifier).length === 0 ? EXTENSION_ORDER.map((extension) => `${specifier}${extension}`) : []

const indexedCandidates = (specifier: string): readonly string[] =>
  EXTENSION_ORDER.map((extension) => `${specifier}/index${extension}`)

const candidatesOf = (specifier: string): readonly string[] => [
  specifier,
  ...swappedCandidates(specifier),
  ...appendedCandidates(specifier),
  ...indexedCandidates(specifier),
]

const memberOf = (files: HashSet.HashSet<string>, specifier: string): string | undefined =>
  candidatesOf(specifier).find((candidate) => HashSet.has(files, candidate))

const isSkippable = (segment: string): boolean => segment.length === 0 || segment === '.'

const resolveSegment = (kept: string[], segment: string): void => {
  if (segment === '..') kept.pop()
  else kept.push(segment)
}

const applySegment = (kept: string[], segment: string): void => {
  if (isSkippable(segment)) return
  resolveSegment(kept, segment)
}

const rootPrefixOf = (fromDirectory: string): string => fromDirectory.startsWith('/') ? '/' : ''

const joinSpecifier = (fromDirectory: string, specifier: string): string => {
  const kept: string[] = []
  for (const segment of [...fromDirectory.split('/'), ...specifier.split('/')]) applySegment(kept, segment)
  return `${rootPrefixOf(fromDirectory)}${kept.join('/')}`
}

const directoryOf = (key: string): string => key.split('/').slice(0, -1).join('/')

const isRootSpecifier = (specifier: string): boolean => specifier.startsWith('/')

const pathSpecifierKey = (input: ResolveInput): string =>
  isRootSpecifier(input.specifier)
    ? input.specifier.slice(1)
    : joinSpecifier(directoryOf(input.key), input.specifier)

const memberResolution = (file: string): Resolution => ({ kind: 'Member', file })

const firstFlaggedOf = (candidates: readonly string[], flags: readonly boolean[]): string | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Arr.findFirstIndex(flags, (flag) => flag), (index) => Arr.get(candidates, index)),
  )

const candidateFileOf = Effect.fnUntraced(function*(realRoot: string, specifier: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const candidates = candidatesOf(specifier)
  const flags = yield* Effect.forEach(candidates, (candidate) =>
    fs.stat(path.resolve(realRoot, candidate)).pipe(
      Effect.map((info) => info.type === 'File'),
      Effect.orElseSucceed(() => false),
    ))
  return firstFlaggedOf(candidates, flags)
})

const resolutionOfFile = (file: string | undefined): Resolution =>
  Option.match(Option.fromUndefinedOr(file), {
    onNone: () => UNRESOLVED_RESOLUTION,
    onSome: (present) => memberResolution(present),
  })

const candidateResolutionOf = Effect.fnUntraced(function*(realRoot: string, specifier: string) {
  return resolutionOfFile(yield* candidateFileOf(realRoot, specifier))
})

const memberResolutionOf = Effect.fnUntraced(function*(
  input: ResolveInput,
  specifier: string,
): Effect.fn.Return<Resolution, never, FileSystem.FileSystem | Path.Path> {
  const member = Option.fromUndefinedOr(memberOf(input.files, specifier))
  return yield* Option.match(member, {
    onSome: (present) => Effect.succeed(memberResolution(present)),
    onNone: () => candidateResolutionOf(input.realRoot, specifier),
  })
})

const resolvePathSpecifier = Effect.fnUntraced(function*(input: ResolveInput) {
  return yield* memberResolutionOf(input, pathSpecifierKey(input))
})

const ancestorsOf = (path: Path.Path, directory: string): readonly string[] =>
  path.dirname(directory) === directory ? [directory] : [directory, ...ancestorsOf(path, path.dirname(directory))]

const packageCandidatesOf = (path: Path.Path, input: ResolveInput, packageName: string): readonly string[] =>
  ancestorsOf(path, path.resolve(input.realRoot, directoryOf(input.key))).map((directory) =>
    path.join(directory, 'node_modules', packageName)
  )

const existingFlagsOf = Effect.fnUntraced(function*(realRoot: string, candidates: readonly string[]) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  return yield* Effect.forEach(candidates, (candidate) => fs.exists(path.resolve(realRoot, candidate)))
})

const packageDirectoryOf = Effect.fnUntraced(function*(input: ResolveInput, packageName: string) {
  const candidates = packageCandidatesOf(yield* Path.Path, input, packageName)
  const flags = yield* existingFlagsOf(input.realRoot, candidates)
  return firstFlaggedOf(candidates, flags)
})

const realPathOf = Effect.fnUntraced(function*(absolute: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.realPath(absolute).pipe(Effect.orElseSucceed(() => absolute))
})

const manifestOf = Effect.fnUntraced(function*(packageDirectory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const content = yield* fs.readFileString(path.join(packageDirectory, 'package.json')).pipe(
    Effect.orElseSucceed(() => ''),
  )
  return Option.getOrUndefined(S.decodeOption(S.fromJsonString(PackageManifestSchema))(content))
})

const manifestTargetOf = (
  manifest: PackageManifest | undefined,
  request: PackageExportRequest | PackageImportRequest,
): ManifestTarget =>
  manifest === undefined
    ? ManifestTargetMissing.make({})
    : Result.getOrElse(
      selectManifestTarget(ManifestTargetCommand.make({ manifest, request })),
      (unreachable: never) => unreachable,
    )

const specifierKindOf = (specifier: string): ModuleSpecifierKind =>
  Result.getOrElse(
    classifyModuleSpecifier(ClassifyModuleSpecifierCommand.make({ specifier, builtins: BUILTIN_MODULES })),
    (unreachable: never) => unreachable,
  )

const followWorkspacePackage = Effect.fnUntraced(function*(
  input: ResolveInput,
  packageDirectory: string,
  packageKey: string,
  subpath: string,
) {
  const target = manifestTargetOf(yield* manifestOf(packageDirectory), PackageExportRequest.make({ subpath }))
  return yield* Match.value(target).pipe(
    Match.tag('ManifestPathTarget', (present) => memberResolutionOf(input, joinSpecifier(packageKey, present.target))),
    Match.tag('ManifestPackageTarget', 'ManifestTargetMissing', () => Effect.succeed(UNRESOLVED_RESOLUTION)),
    Match.exhaustive,
  )
})

const isNodeModulesKey = (key: string): boolean => key.split('/').includes('node_modules')

const classifyPackageDirectory = Effect.fnUntraced(function*(
  input: ResolveInput,
  directory: string,
  subpath: string,
) {
  const path = yield* Path.Path
  const real = yield* realPathOf(path.resolve(input.realRoot, directory))
  const key = relativeNormalizedFileName(real, input.realRoot)
  return yield* Option.match(Option.liftPredicate(key, isNodeModulesKey), {
    onNone: () => followWorkspacePackage(input, real, key, subpath),
    onSome: () => Effect.succeed(EXTERNAL_RESOLUTION),
  })
})

const resolvePackageSpecifier = Effect.fnUntraced(function*(input: ResolveInput, specifier: PackageSpecifier) {
  const directory = yield* packageDirectoryOf(input, specifier.packageName)
  return yield* Option.match(Option.fromUndefinedOr(directory), {
    onNone: () => Effect.succeed(UNRESOLVED_RESOLUTION),
    onSome: (present) => classifyPackageDirectory(input, present, specifier.subpath),
  })
})

const resolveBareSpecifier = (input: ResolveInput) =>
  Match.value(specifierKindOf(input.specifier)).pipe(
    Match.tag('BuiltinSpecifier', () => Effect.succeed(EXTERNAL_RESOLUTION)),
    Match.tag('PackageSpecifier', (specifier) => resolvePackageSpecifier(input, specifier)),
    Match.tag('PathSpecifier', 'SubpathImportSpecifier', () => Effect.succeed(UNRESOLVED_RESOLUTION)),
    Match.exhaustive,
  )

const packageScopeOf = Effect.fnUntraced(function*(input: ResolveInput) {
  const path = yield* Path.Path
  const directories = ancestorsOf(path, path.resolve(input.realRoot, directoryOf(input.key)))
  const flags = yield* existingFlagsOf(
    input.realRoot,
    directories.map((directory) => path.join(directory, PACKAGE_MANIFEST_FILE)),
  )
  return firstFlaggedOf(directories, flags)
})

const followPackageImport = Effect.fnUntraced(function*(input: ResolveInput, scopeDirectory: string) {
  const real = yield* realPathOf(scopeDirectory)
  const scopeKey = relativeNormalizedFileName(real, input.realRoot)
  const target = manifestTargetOf(
    yield* manifestOf(real),
    PackageImportRequest.make({ specifier: input.specifier }),
  )
  return yield* Match.value(target).pipe(
    Match.tag('ManifestPathTarget', (present) => memberResolutionOf(input, joinSpecifier(scopeKey, present.target))),
    Match.tag('ManifestPackageTarget', (present) =>
      resolveBareSpecifier({
        ...input,
        key: joinSpecifier(scopeKey, PACKAGE_MANIFEST_FILE),
        specifier: present.specifier,
      })),
    Match.tag('ManifestTargetMissing', () => Effect.succeed(UNRESOLVED_RESOLUTION)),
    Match.exhaustive,
  )
})

const resolveSubpathImport = Effect.fnUntraced(function*(input: ResolveInput) {
  const scope = yield* packageScopeOf(input)
  return yield* Option.match(Option.fromUndefinedOr(scope), {
    onNone: () => Effect.succeed(UNRESOLVED_RESOLUTION),
    onSome: (present) => followPackageImport(input, present),
  })
})

const resolveSpecifier = (input: ResolveInput) =>
  Match.value(specifierKindOf(input.specifier)).pipe(
    Match.tag('PathSpecifier', () => resolvePathSpecifier(input)),
    Match.tag('SubpathImportSpecifier', () => resolveSubpathImport(input)),
    Match.tag('BuiltinSpecifier', () => Effect.succeed(EXTERNAL_RESOLUTION)),
    Match.tag('PackageSpecifier', (specifier) => resolvePackageSpecifier(input, specifier)),
    Match.exhaustive,
  )

const resolveMemoized = Effect.fnUntraced(function*(
  memo: MutableHashMap.MutableHashMap<string, Resolution>,
  input: ResolveInput,
) {
  const memoKey = `${directoryOf(input.key)}\u0000${input.specifier}`
  const cached = MutableHashMap.get(memo, memoKey)
  if (Option.isSome(cached)) return cached.value
  const resolution = yield* resolveSpecifier(input)
  MutableHashMap.set(memo, memoKey, resolution)
  return resolution
})

const resolutionFiles = (resolution: Resolution): readonly string[] =>
  resolution.kind === 'Member' ? [resolution.file] : []

const opensClosure = (resolution: Resolution): boolean => resolution.kind === 'Unresolved'

const dependencyFiles = (resolutions: readonly Resolution[]): readonly string[] =>
  [...HashSet.fromIterable(resolutions.flatMap(resolutionFiles))].sort()

const replaceDirectory = (roots: Roots, file: string): string =>
  file.startsWith(`${roots.rootDir}/`) ? `${roots.realRoot}${file.slice(roots.rootDir.length)}` : file

const keyOf = (roots: Roots, file: string): string =>
  relativeNormalizedFileName(replaceDirectory(roots, file), roots.realRoot)

const readRoots = Effect.fnUntraced(function*(input: ImportClosureInput) {
  const fs = yield* FileSystem.FileSystem
  return { rootDir: input.rootDir, realRoot: yield* fs.realPath(input.rootDir) }
})

const readProjectFile = Effect.fnUntraced(function*(roots: Roots, file: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const key = keyOf(roots, file)
  const absolute = path.resolve(roots.realRoot, key)
  return { key, absolute, content: yield* fs.readFileString(absolute) }
})

const isPackageManifest = (key: string): boolean =>
  key === PACKAGE_MANIFEST_FILE || key.endsWith(`/${PACKAGE_MANIFEST_FILE}`)

const verdictContentOf = (loaded: LoadedFile): Effect.Effect<string> =>
  isPackageManifest(loaded.key) ? packageManifestInputOf(loaded.content) : Effect.succeed(loaded.content)

const unparsedScan = (loaded: LoadedFile, verdictContent: string): ModuleScan => ({
  key: loaded.key,
  contentHash: hashOf(verdictContent),
  dependencies: [],
  open: INERT_EXTENSIONS[extensionOf(loaded.key)] !== true,
  dynamicOpen: false,
})

const parsedScan = Effect.fnUntraced(function*(
  loaded: LoadedFile,
  language: ScriptLanguage,
  resolve: (specifier: string) => Effect.Effect<Resolution, PlatformError, FileSystem.FileSystem | Path.Path>,
) {
  const scan = yield* scanSource(loaded.content, loaded.absolute, language)
  const resolutions = yield* Effect.forEach(scan.specifiers, resolve, { concurrency: CONCURRENCY })
  return {
    key: loaded.key,
    contentHash: hashOf(loaded.content),
    dependencies: dependencyFiles(resolutions),
    open: scan.parseFailed || resolutions.some(opensClosure),
    dynamicOpen: scan.dynamicOpen,
  }
})

const moduleScanOf = Effect.fnUntraced(function*(
  roots: Roots,
  files: HashSet.HashSet<string>,
  memo: MutableHashMap.MutableHashMap<string, Resolution>,
  file: string,
) {
  const loaded = yield* readProjectFile(roots, file)
  const language = SCRIPT_LANGUAGES[extensionOf(loaded.key)]
  if (language === undefined) return unparsedScan(loaded, yield* verdictContentOf(loaded))
  return yield* parsedScan(loaded, language, (specifier) =>
    resolveMemoized(memo, {
      files,
      realRoot: roots.realRoot,
      key: loaded.key,
      absolute: loaded.absolute,
      specifier,
    }))
})

const OPEN_COMBINERS: Readonly<Record<OpenMode, (scan: ModuleScan) => boolean>> = {
  Combined: (scan) => scan.open || scan.dynamicOpen,
  Structural: (scan) => scan.open,
}

const openFor = (mode: OpenMode, scan: ModuleScan): boolean => OPEN_COMBINERS[mode](scan)

const moduleEntry = (mode: OpenMode) => (scan: ModuleScan): readonly [string, ImportClosureModule] => [
  scan.key,
  { dependencies: scan.dependencies, open: openFor(mode, scan) },
]

const modulesOf = (mode: OpenMode, scanned: readonly ModuleScan[]): Record<string, ImportClosureModule> =>
  Object.fromEntries(scanned.map(moduleEntry(mode)))

const digestLine = (scan: ModuleScan): string => `${scan.key}\u0000${scan.contentHash}`

const projectDigestOf = (scanned: readonly ModuleScan[]): string => hashOf(scanned.map(digestLine).sort().join('\n'))

const sortedKeys = (roots: Roots, files: readonly string[]): readonly string[] =>
  [...HashSet.fromIterable(files.map((file) => keyOf(roots, file)))].sort()

const commandGlobalInputs = (roots: Roots, input: ImportClosureInput): readonly string[] =>
  sortedKeys(roots, input.globalInputs ?? [])

const commandOf = (
  input: ImportClosureInput,
  roots: Roots,
  scanned: readonly ModuleScan[],
  testFiles: readonly string[],
  mode: OpenMode,
): ImportClosureCommand =>
  ImportClosureCommand.make({
    modules: modulesOf(mode, scanned),
    globalInputs: commandGlobalInputs(roots, input),
    testFiles,
  })

const contentHashOf = (
  hashes: MutableHashMap.MutableHashMap<string, string>,
  file: string,
): string => Option.getOrElse(MutableHashMap.get(hashes, file), () => '')

const closureDigestOf = (
  hashes: MutableHashMap.MutableHashMap<string, string>,
  projectDigest: string,
  closure: TestFileClosure,
): string =>
  hashOf(
    [
      ...[...closure.files]
        .sort()
        .map((file) => `${file}\u0000${contentHashOf(hashes, file)}`),
      ...(closure.open ? [projectDigest] : []),
    ].join('\n'),
  )

const closureWithDigest = (
  hashes: MutableHashMap.MutableHashMap<string, string>,
  projectDigest: string,
  closure: TestFileClosure,
): TestFileClosureDigest => ({
  testFile: closure.testFile,
  files: closure.files,
  open: closure.open,
  digest: closureDigestOf(hashes, projectDigest, closure),
})

const scannedOf = (scanned: MutableHashMap.MutableHashMap<string, ModuleScan>): readonly ModuleScan[] => [
  ...MutableHashMap.values(scanned),
]

const pendingDependenciesOf = (
  scans: readonly ModuleScan[],
  scanned: MutableHashMap.MutableHashMap<string, ModuleScan>,
): readonly string[] =>
  scans.flatMap((scan) => scan.dependencies).filter((dependency) => !MutableHashMap.has(scanned, dependency))

const nextBatchOf = (pending: readonly string[]): Option.Option<readonly string[]> =>
  Option.liftPredicate(pending, (waiting) => waiting.length > 0)

const scanPendingOf = Effect.fnUntraced(function*(
  roots: Roots,
  files: HashSet.HashSet<string>,
  memo: MutableHashMap.MutableHashMap<string, Resolution>,
  scanned: MutableHashMap.MutableHashMap<string, ModuleScan>,
  pending: readonly string[],
): Effect.fn.Return<readonly ModuleScan[], PlatformError, FileSystem.FileSystem | Path.Path | SourceParser> {
  const batch = Arr.dedupe(pending).filter((file) => !MutableHashMap.has(scanned, file))
  const results = yield* Effect.forEach(
    batch,
    (file) => moduleScanOf(roots, files, memo, file),
    { concurrency: CONCURRENCY },
  )
  yield* Effect.forEach(
    results,
    (scan) => Effect.sync(() => MutableHashMap.set(scanned, scan.key, scan)),
    { discard: true },
  )
  const next = nextBatchOf(pendingDependenciesOf(results, scanned))
  const entries = scannedOf(scanned)
  return yield* Option.match(next, {
    onNone: () => Effect.succeed(entries),
    onSome: (waiting) => scanPendingOf(roots, files, memo, scanned, waiting),
  })
})

const scanReachable = (
  roots: Roots,
  files: HashSet.HashSet<string>,
  memo: MutableHashMap.MutableHashMap<string, Resolution>,
  seeds: readonly string[],
): Effect.Effect<readonly ModuleScan[], PlatformError, FileSystem.FileSystem | Path.Path | SourceParser> =>
  scanPendingOf(roots, files, memo, MutableHashMap.empty<string, ModuleScan>(), seeds)

const leafScanOf = Effect.fnUntraced(function*(roots: Roots, file: string) {
  const loaded = yield* readProjectFile(roots, file)
  return {
    key: loaded.key,
    contentHash: hashOf(loaded.content),
    dependencies: [],
    open: false,
    dynamicOpen: false,
  }
})

const scannedKeysOf = (scanned: readonly ModuleScan[]): HashSet.HashSet<string> =>
  HashSet.fromIterable(scanned.map((scan) => scan.key))

const globalInputKeysOf = (
  roots: Roots,
  input: ImportClosureInput,
  scanned: readonly ModuleScan[],
): readonly string[] =>
  sortedKeys(roots, input.globalInputs ?? []).filter((key) => !HashSet.has(scannedKeysOf(scanned), key))

const hashGlobalInputsOf = Effect.fnUntraced(function*(roots: Roots, keys: readonly string[]) {
  const scans = yield* Effect.forEach(
    keys,
    (key) => Effect.option(leafScanOf(roots, key)),
    { concurrency: CONCURRENCY },
  )
  return Arr.getSomes(scans)
})

const infoIsFile = (type: string | undefined): boolean => type === 'File'

const statTypeOf = Effect.fnUntraced(function*(fs: FileSystem.FileSystem, path: Path.Path, value: string) {
  if (!path.isAbsolute(value)) return undefined
  return yield* fs.stat(value).pipe(Effect.map((info) => info.type), Effect.orElseSucceed(() => undefined))
})

const observedRootOf = Effect.fnUntraced(function*(roots: Roots, value: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const type = yield* statTypeOf(fs, path, value)
  return infoIsFile(type) ? Option.some(keyOf(roots, value)) : Option.none<string>()
})

const observedTestEvidenceOf = Effect.fnUntraced(function*(roots: Roots, keys: readonly string[]) {
  const observed = yield* Effect.forEach(keys, (key) => observedRootOf(roots, key), { concurrency: CONCURRENCY })
  return { roots: Arr.getSomes(observed), invalid: observed.some(Option.isNone) }
})

const observedEntries = (input: ImportClosureInput): readonly (readonly [string, readonly string[]])[] =>
  Object.entries(input.observedModules ?? {})

const observedEvidenceOf = Effect.fnUntraced(function*(roots: Roots, input: ImportClosureInput) {
  const resolved = yield* Effect.forEach(
    observedEntries(input),
    ([testFile, keys]) =>
      observedTestEvidenceOf(roots, keys).pipe(
        Effect.map((entry) => [keyOf(roots, testFile), entry] as const),
      ),
    { concurrency: CONCURRENCY },
  )
  return new Map(resolved)
})

const unknownKeys = (known: HashSet.HashSet<string>, keys: readonly string[]): readonly string[] =>
  [...HashSet.fromIterable(keys)].filter((key) => !HashSet.has(known, key))

const observedScansOf = Effect.fnUntraced(function*(
  roots: Roots,
  files: HashSet.HashSet<string>,
  memo: MutableHashMap.MutableHashMap<string, Resolution>,
  known: readonly ModuleScan[],
  keys: readonly string[],
) {
  const pending = unknownKeys(scannedKeysOf(known), keys)
  const sourceKeys = pending.filter((key) => !isNodeModulesKey(key))
  const nodeKeys = pending.filter(isNodeModulesKey)
  const sourceScans = sourceKeys.length === 0 ? [] : yield* scanReachable(roots, files, memo, sourceKeys)
  const leafScans = yield* Effect.forEach(
    nodeKeys,
    (key) => Effect.option(leafScanOf(roots, key)),
    { concurrency: CONCURRENCY },
  )
  return [...sourceScans, ...Arr.getSomes(leafScans)]
})

const augmentModule = (member: ImportClosureModule, entry: ObservedEvidence): ImportClosureModule => ({
  dependencies: [...HashSet.fromIterable([...member.dependencies, ...entry.roots])].sort(),
  open: member.open || entry.invalid,
})

const augmentedModules = (
  modules: Record<string, ImportClosureModule>,
  evidence: ReadonlyMap<string, ObservedEvidence>,
): Record<string, ImportClosureModule> =>
  [...evidence].reduce((augmented, [testFile, entry]) => {
    const member = augmented[testFile]
    return member === undefined ? augmented : { ...augmented, [testFile]: augmentModule(member, entry) }
  }, { ...modules })

const evidenceCommandOf = (
  input: ImportClosureInput,
  roots: Roots,
  scanned: readonly ModuleScan[],
  evidence: ReadonlyMap<string, ObservedEvidence>,
  testFiles: readonly string[],
): ImportClosureCommand =>
  ImportClosureCommand.make({
    modules: augmentedModules(modulesOf('Structural', scanned), evidence),
    globalInputs: commandGlobalInputs(roots, input),
    testFiles,
  })

const closuresOf = (command: ImportClosureCommand): readonly TestFileClosure[] =>
  Result.getOrElse(importClosure(command), (unreachable: never) => unreachable)

export const analyzeImportClosure = Effect.fnUntraced(function*(
  input: ImportClosureInput,
): Effect.fn.Return<ImportClosureAnalysis, PlatformError, FileSystem.FileSystem | Path.Path | SourceParser> {
  const roots = yield* readRoots(input)
  const testKeys = sortedKeys(roots, input.testFiles)
  const seeds = [...HashSet.fromIterable(input.projectFiles.map((file) => keyOf(roots, file)))]
  const files = HashSet.fromIterable(seeds)
  const memo = MutableHashMap.empty<string, Resolution>()
  const reachable = yield* scanReachable(roots, files, memo, seeds)
  const globalScans = yield* hashGlobalInputsOf(roots, globalInputKeysOf(roots, input, reachable))
  const baseScanned = [...reachable, ...globalScans]
  const projectDigest = projectDigestOf(baseScanned)
  const baseHashes = MutableHashMap.fromIterable(baseScanned.map((scan) => [scan.key, scan.contentHash] as const))
  const evidence = yield* observedEvidenceOf(roots, input)
  const unevidenced = testKeys.filter((key) => !evidence.has(key))
  const evidenced = testKeys.filter((key) => evidence.has(key))
  const baseClosures = closuresOf(commandOf(input, roots, baseScanned, unevidenced, 'Combined'))
  if (evidenced.length === 0) {
    return {
      closures: baseClosures.map((closure) => closureWithDigest(baseHashes, projectDigest, closure)),
      projectDigest,
    }
  }
  const baseKeys = scannedKeysOf(baseScanned)
  const observedScans = (yield* observedScansOf(
    roots,
    files,
    memo,
    baseScanned,
    Arr.dedupe([...evidence.values()].flatMap((entry) => entry.roots)),
  )).filter((scan) => !HashSet.has(baseKeys, scan.key))
  const scanned = [...baseScanned, ...observedScans]
  const hashes = MutableHashMap.fromIterable(scanned.map((scan) => [scan.key, scan.contentHash] as const))
  const evidenceClosures = closuresOf(evidenceCommandOf(input, roots, scanned, evidence, evidenced))
  const byTestFile = new Map(
    [...baseClosures, ...evidenceClosures].map((closure) => [closure.testFile, closure] as const),
  )
  const closures = testKeys.flatMap((key) => Option.toArray(Option.fromUndefinedOr(byTestFile.get(key))))
  return {
    closures: closures.map((closure) => closureWithDigest(hashes, projectDigest, closure)),
    projectDigest,
  }
})
