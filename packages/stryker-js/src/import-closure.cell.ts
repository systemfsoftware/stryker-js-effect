import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashSet from 'effect/HashSet'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { relativeNormalizedFileName } from './FileMatcher.js'
import {
  type ExportEntry,
  ImportClosureCommand,
  type ImportClosureModule,
  type PackageManifest,
  PackageManifestSchema,
  type TestFileClosure,
} from './import-closure.schema.js'
import { importClosure } from './import-closure.workflow.js'
import { packageManifestInputOf } from './verdict-semantics.js'

export interface ImportClosureInput {
  readonly rootDir: string
  readonly projectFiles: readonly string[]
  readonly testFiles: readonly string[]
  readonly globalInputs?: readonly string[]
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

type AstValue = object | string | number | boolean | null | undefined | readonly AstValue[]
type AstNode = { readonly type: string } & Readonly<Record<string, AstValue>>
type ScriptLanguage = 'js' | 'jsx' | 'ts' | 'tsx'

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
}

interface Extraction {
  readonly specifier: string | undefined
  readonly hidden: boolean
}

interface Scan {
  readonly specifiers: readonly string[]
  readonly open: boolean
}

interface ScanState {
  readonly specifiers: HashSet.HashSet<string>
  readonly open: boolean
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

const PACKAGE_SOURCE_CONDITION = '@systemfsoftware/source'

const DEFAULT_ENTRY_KEY = '.'

const WILDCARD_ENTRY_KEY = './*'

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

const STATIC_SOURCE_TYPES: Readonly<Record<string, true>> = {
  ExportAllDeclaration: true,
  ExportNamedDeclaration: true,
  ImportDeclaration: true,
}

const MOCK_METHODS: Readonly<Record<string, true>> = {
  doMock: true,
  importActual: true,
  importMock: true,
  mock: true,
  unmock: true,
}

const LITERAL_TYPES: Readonly<Record<string, true>> = { Literal: true, StringLiteral: true }

const NOTHING: Extraction = { specifier: undefined, hidden: false }
const EMPTY_STATE: ScanState = { specifiers: HashSet.empty(), open: false }
const EXTERNAL_RESOLUTION: Resolution = { kind: 'External', file: '' }
const UNRESOLVED_RESOLUTION: Resolution = { kind: 'Unresolved', file: '' }

const hashOf = (content: string): string => bytesToHex(sha256(utf8ToBytes(content)))

const isObjectLike = (value: AstValue): value is object => typeof value === 'object' && value !== null

const hasTextType = (value: object): boolean => typeof Reflect.get(value, 'type') === 'string'

const isNode = (value: AstValue): value is AstNode => isObjectLike(value) && hasTextType(value)

const nodeOf = (value: AstValue): AstNode | undefined => Option.getOrUndefined(Option.liftPredicate(value, isNode))

const isArrayOfValues = (value: AstValue): value is readonly AstValue[] => Array.isArray(value)

const valuesOf = (value: AstValue): readonly AstValue[] => (isArrayOfValues(value) ? value : [value])

const nodeValuesOf = (node: AstNode): readonly AstValue[] => Object.values(node).flatMap(valuesOf)

const isText = (value: AstValue): value is string => typeof value === 'string'

const fieldOf = (node: AstNode | undefined, key: string): AstValue => node === undefined ? undefined : node[key]

const textFieldOf = (node: AstNode | undefined, key: string): string | undefined =>
  Option.getOrUndefined(Option.liftPredicate(fieldOf(node, key), isText))

const identifierNameOf = (value: AstValue): string | undefined => textFieldOf(nodeOf(value), 'name')

const memberFieldOf = (value: AstValue, key: string): AstValue => fieldOf(nodeOf(value), key)

const isIdentifier = (value: AstValue, name: string): boolean => identifierNameOf(value) === name

const isLiteral = (node: AstNode): boolean => LITERAL_TYPES[node['type']] === true

const isQuotedText = (raw: AstValue): raw is string => isText(raw) && raw.length >= 2

const unquotedOf = (raw: AstValue): string | undefined => (isQuotedText(raw) ? raw.slice(1, -1) : undefined)

const textOrRawOf = (node: AstNode): string | undefined => {
  const inner = node['value']
  return isText(inner) ? inner : unquotedOf(node['raw'])
}

const literalTextOf = (node: AstNode): string | undefined => (isLiteral(node) ? textOrRawOf(node) : undefined)

const extractionOfSource = (source: AstValue): Extraction => isNode(source) ? literalExtraction(source) : NOTHING

const literalExtraction = (node: AstNode): Extraction =>
  literalTextOf(node) === undefined
    ? { specifier: undefined, hidden: true }
    : { specifier: literalTextOf(node), hidden: false }

const firstSpecifier = (left: Extraction, right: Extraction): string | undefined => left.specifier ?? right.specifier

const eitherHidden = (left: Extraction, right: Extraction): boolean => left.hidden || right.hidden

const mergeExtractions = (left: Extraction, right: Extraction): Extraction => ({
  specifier: firstSpecifier(left, right),
  hidden: eitherHidden(left, right),
})

const staticSourceExtraction = (node: AstNode): Extraction =>
  STATIC_SOURCE_TYPES[node['type']] === true ? extractionOfSource(node['source']) : NOTHING

const dynamicImportExtraction = (node: AstNode): Extraction =>
  node['type'] === 'ImportExpression' ? extractionOfSource(node['source']) : NOTHING

const callExtraction = (node: AstNode): Extraction =>
  node['type'] === 'CallExpression' ? callSpecifierExtraction(node) : NOTHING

const callSpecifierExtraction = (node: AstNode): Extraction =>
  isSpecifierCall(node) ? extractionOfSource(firstArgumentOf(node)) : NOTHING

const isSpecifierCall = (node: AstNode): boolean => isRequireCall(node) || isMockCall(node)

const isRequireCall = (node: AstNode): boolean => isIdentifier(node['callee'], 'require')

const isVitestCallee = (callee: AstValue): boolean =>
  isIdentifier(memberFieldOf(callee, 'object'), 'vi') ||
  isIdentifier(memberFieldOf(callee, 'object'), 'vitest')

const isMockMethodName = (name: string | undefined): boolean => name === undefined ? false : MOCK_METHODS[name] === true

const isMockMethod = (callee: AstValue): boolean =>
  isMockMethodName(identifierNameOf(memberFieldOf(callee, 'property')))

const isMockCall = (node: AstNode): boolean => isVitestCallee(node['callee']) && isMockMethod(node['callee'])

const firstArgumentOf = (node: AstNode): AstValue => valuesOf(node['arguments'])[0]

const extractionOf = (node: AstNode): Extraction =>
  mergeExtractions(
    staticSourceExtraction(node),
    mergeExtractions(dynamicImportExtraction(node), callExtraction(node)),
  )

const mergeState = (state: ScanState, extraction: Extraction): ScanState => ({
  specifiers: specifierState(state, extraction),
  open: state.open || extraction.hidden,
})

const specifierState = (state: ScanState, extraction: Extraction): HashSet.HashSet<string> =>
  extraction.specifier === undefined ? state.specifiers : HashSet.add(state.specifiers, extraction.specifier)

const stepValue = (state: ScanState, value: AstValue): ScanState => (isNode(value) ? walk(state, value) : state)

const walk = (state: ScanState, node: AstNode): ScanState =>
  nodeValuesOf(node).reduce(stepValue, mergeState(state, extractionOf(node)))

const scanProgram = (program: AstValue): Scan => {
  const state = isNode(program) ? walk(EMPTY_STATE, program) : EMPTY_STATE
  return { specifiers: [...state.specifiers], open: state.open }
}

const oxcModule = Effect.cached(Effect.promise(() => import('oxc-parser')))

const scanSource = Effect.fnUntraced(function*(content: string, absolute: string, language: ScriptLanguage) {
  const oxc = yield* Effect.flatMap(oxcModule, (load) => load)
  const parsed = oxc.parseSync(absolute, content, { lang: language })
  const scan = scanProgram(parsed.program)
  return { specifiers: scan.specifiers, open: scan.open || parsed.errors.length > 0 }
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

const isRelativeSpecifier = (specifier: string): boolean => specifier.startsWith('.')

const isRootSpecifier = (specifier: string): boolean => specifier.startsWith('/')

const isPathSpecifier = (specifier: string): boolean => isRelativeSpecifier(specifier) || isRootSpecifier(specifier)

const pathSpecifierKey = (input: ResolveInput): string =>
  isRootSpecifier(input.specifier)
    ? input.specifier.slice(1)
    : joinSpecifier(directoryOf(input.key), input.specifier)

const memberResolution = (file: string): Resolution => ({ kind: 'Member', file })

const candidateFileOf = Effect.fnUntraced(function*(realRoot: string, specifier: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const candidates = candidatesOf(specifier)
  const flags = yield* Effect.forEach(candidates, (candidate) =>
    fs.stat(path.resolve(realRoot, candidate)).pipe(
      Effect.map((info) => info.type === 'File'),
      Effect.orElseSucceed(() => false),
    ))
  return candidates.find((_, index) => flags[index] === true)
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

const packageNameOf = (specifier: string): string => {
  const segments = specifier.split('/')
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : Option.getOrElse(Option.fromNullishOr(segments[0]), () => '')
}

const subpathOf = (specifier: string): string => specifier.slice(packageNameOf(specifier).length + 1)

const directoryChainOf = (fromDirectory: string): readonly string[] => {
  const parts = fromDirectory.split('/').filter((part) => part.length > 0)
  return [...parts.map((_, index) => parts.slice(0, index + 1).join('/')), '']
}

const packageCandidateOf = (directory: string, packageName: string): string =>
  `${directory.length === 0 ? '' : `${directory}/`}node_modules/${packageName}`

const packageCandidatesOf = (input: ResolveInput): readonly string[] =>
  directoryChainOf(directoryOf(input.key)).map((directory) =>
    packageCandidateOf(directory, packageNameOf(input.specifier))
  )

const existingFlagsOf = Effect.fnUntraced(function*(realRoot: string, candidates: readonly string[]) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  return yield* Effect.forEach(candidates, (candidate) => fs.exists(path.resolve(realRoot, candidate)))
})

const packageDirectoryOf = Effect.fnUntraced(function*(input: ResolveInput) {
  const candidates = packageCandidatesOf(input)
  const flags = yield* existingFlagsOf(input.realRoot, candidates)
  return candidates.find((_, index) => flags[index] === true)
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

const entryKeyOf = (subpath: string): string => (subpath.length === 0 ? DEFAULT_ENTRY_KEY : `./${subpath}`)

const conditionTargetOption = (conditions: Readonly<Record<string, string>>): Option.Option<string> =>
  Option.orElse(
    Option.fromNullishOr(conditions[PACKAGE_SOURCE_CONDITION]),
    () => Option.fromNullishOr(Object.values(conditions)[0]),
  )

const exportEntryTargetOption = (entry: ExportEntry): Option.Option<string> =>
  isText(entry) ? Option.some(entry) : conditionTargetOption(entry)

const entryTargetOption = (
  exportsMap: Readonly<Record<string, ExportEntry>>,
  key: string,
): Option.Option<string> => Option.flatMap(Option.fromUndefinedOr(exportsMap[key]), exportEntryTargetOption)

const wildcardTargetOption = (
  exportsMap: Readonly<Record<string, ExportEntry>>,
  subpath: string,
): Option.Option<string> =>
  subpath.length === 0
    ? Option.none()
    : Option.flatMap(entryTargetOption(exportsMap, WILDCARD_ENTRY_KEY), (target) =>
      Option.some(target.replace('*', subpath)))

const mapTargetOption = (
  exportsMap: Readonly<Record<string, ExportEntry>>,
  subpath: string,
): Option.Option<string> =>
  Option.orElse(entryTargetOption(exportsMap, entryKeyOf(subpath)), () => wildcardTargetOption(exportsMap, subpath))

const rootTargetOption = (target: string, subpath: string): Option.Option<string> =>
  subpath.length === 0 ? Option.some(target) : Option.none()

const exportsTargetOption = (
  exports: string | Readonly<Record<string, ExportEntry>>,
  subpath: string,
): Option.Option<string> => isText(exports) ? rootTargetOption(exports, subpath) : mapTargetOption(exports, subpath)

const mainTargetOption = (manifest: PackageManifest): Option.Option<string> =>
  Option.orElse(Option.fromNullishOr(manifest.main), () => Option.fromNullishOr(manifest.module))

const rootFallbackOption = (manifest: PackageManifest, subpath: string): Option.Option<string> =>
  subpath.length === 0 ? mainTargetOption(manifest) : Option.none()

const manifestTargetOption = (manifest: PackageManifest, subpath: string): Option.Option<string> =>
  Option.orElse(
    Option.flatMap(Option.fromUndefinedOr(manifest.exports), (exports) => exportsTargetOption(exports, subpath)),
    () => rootFallbackOption(manifest, subpath),
  )

const packageTargetOf = Effect.fnUntraced(function*(packageDirectory: string, subpath: string) {
  const manifest = yield* manifestOf(packageDirectory)
  return Option.flatMap(Option.fromUndefinedOr(manifest), (present) => manifestTargetOption(present, subpath))
})

const followWorkspacePackage = Effect.fnUntraced(function*(
  input: ResolveInput,
  packageDirectory: string,
  packageKey: string,
) {
  const target = yield* packageTargetOf(packageDirectory, subpathOf(input.specifier))
  return yield* Option.match(target, {
    onNone: () => Effect.succeed(UNRESOLVED_RESOLUTION),
    onSome: (present) => memberResolutionOf(input, joinSpecifier(packageKey, present)),
  })
})

const isNodeModulesKey = (key: string): boolean => key.split('/').includes('node_modules')

const classifyPackageDirectory = Effect.fnUntraced(function*(input: ResolveInput, directory: string) {
  const path = yield* Path.Path
  const real = yield* realPathOf(path.resolve(input.realRoot, directory))
  const key = relativeNormalizedFileName(real, input.realRoot)
  return yield* Option.match(Option.liftPredicate(key, isNodeModulesKey), {
    onNone: () => followWorkspacePackage(input, real, key),
    onSome: () => Effect.succeed(EXTERNAL_RESOLUTION),
  })
})

const resolvePackageSpecifier = Effect.fnUntraced(function*(input: ResolveInput) {
  const directory = yield* packageDirectoryOf(input)
  return yield* Option.match(Option.fromUndefinedOr(directory), {
    onNone: () => Effect.succeed(UNRESOLVED_RESOLUTION),
    onSome: (present) => classifyPackageDirectory(input, present),
  })
})

const resolveSpecifier = Effect.fnUntraced(function*(input: ResolveInput) {
  if (isPathSpecifier(input.specifier)) return yield* resolvePathSpecifier(input)
  return yield* resolvePackageSpecifier(input)
})

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

const PACKAGE_MANIFEST_FILE = 'package.json'

const isPackageManifest = (key: string): boolean =>
  key === PACKAGE_MANIFEST_FILE || key.endsWith(`/${PACKAGE_MANIFEST_FILE}`)

const verdictContentOf = (loaded: LoadedFile): Effect.Effect<string> =>
  isPackageManifest(loaded.key) ? packageManifestInputOf(loaded.content) : Effect.succeed(loaded.content)

const unparsedScan = (loaded: LoadedFile, verdictContent: string): ModuleScan => ({
  key: loaded.key,
  contentHash: hashOf(verdictContent),
  dependencies: [],
  open: INERT_EXTENSIONS[extensionOf(loaded.key)] !== true,
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
    open: scan.open || resolutions.some(opensClosure),
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

const moduleEntry = (scan: ModuleScan): readonly [string, ImportClosureModule] => [
  scan.key,
  { dependencies: scan.dependencies, open: scan.open },
]

const modulesOf = (scanned: readonly ModuleScan[]): Record<string, ImportClosureModule> =>
  Object.fromEntries(scanned.map(moduleEntry))

const digestLine = (scan: ModuleScan): string => `${scan.key}\u0000${scan.contentHash}`

const projectDigestOf = (scanned: readonly ModuleScan[]): string => hashOf(scanned.map(digestLine).sort().join('\n'))

const sortedKeys = (roots: Roots, files: readonly string[]): readonly string[] =>
  [...HashSet.fromIterable(files.map((file) => keyOf(roots, file)))].sort()

const trackableGlobalInputOf = (key: string): boolean => !isNodeModulesKey(key)

const commandOf = (
  input: ImportClosureInput,
  roots: Roots,
  scanned: readonly ModuleScan[],
): ImportClosureCommand =>
  ImportClosureCommand.make({
    modules: modulesOf(scanned),
    globalInputs: sortedKeys(roots, input.globalInputs ?? []).filter(trackableGlobalInputOf),
    testFiles: sortedKeys(roots, input.testFiles),
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
): Effect.fn.Return<readonly ModuleScan[], PlatformError, FileSystem.FileSystem | Path.Path> {
  const batch = [...new Set(pending)].filter((file) => !MutableHashMap.has(scanned, file))
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
): Effect.Effect<readonly ModuleScan[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  scanPendingOf(roots, files, memo, MutableHashMap.empty<string, ModuleScan>(), seeds)

export const analyzeImportClosure = Effect.fnUntraced(function*(
  input: ImportClosureInput,
): Effect.fn.Return<ImportClosureAnalysis, PlatformError, FileSystem.FileSystem | Path.Path> {
  const roots = yield* readRoots(input)
  const seeds = [...HashSet.fromIterable(input.projectFiles.map((file) => keyOf(roots, file)))]
  const files = HashSet.fromIterable(seeds)
  const memo = MutableHashMap.empty<string, Resolution>()
  const scanned = yield* scanReachable(roots, files, memo, seeds)
  const projectDigest = projectDigestOf(scanned)
  const hashes = MutableHashMap.fromIterable(scanned.map((scan) => [scan.key, scan.contentHash] as const))
  const closures = Result.getOrElse(
    importClosure(commandOf(input, roots, scanned)),
    (unreachable: never) => unreachable,
  )
  return {
    closures: closures.map((closure) => closureWithDigest(hashes, projectDigest, closure)),
    projectDigest,
  }
})
