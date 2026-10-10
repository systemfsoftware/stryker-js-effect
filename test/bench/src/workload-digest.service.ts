import {
  type BenchCorpusName,
  coveringTestFiles,
  CoveringTestFilesCommand,
  type CoveringTestFilesFound,
  parseFixtureManifest,
  parseWorkspaceCatalogs,
  resolveCatalogSpecs,
  type WorkspaceCatalogs,
} from '@systemfsoftware/stryker-e2e-core'
import * as Arr from 'effect/Array'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import { Hex } from 'effect/encoding'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const UNREADABLE_DIGEST_PREFIX = 'unreadable:'

export interface WorkloadDigestInput {
  readonly kind: BenchCorpusName
  readonly cwd: string
  readonly sideRoot: string
  readonly incrementalFile: string
}

interface DigestFile {
  readonly relativePath: string
  readonly bytes: Uint8Array
}

const VITEST_CONFIG = /^vitest.*\.config\.ts$/
const TSCONFIG = /^tsconfig.*\.json$/
const STRYKER_CONFIG = 'stryker.config.ts'
const PACKAGE_JSON = 'package.json'
const PNPM_WORKSPACE = 'pnpm-workspace.yaml'
const CATALOG_RESOLUTION_CONFIG = ['packages', 'toolchain', 'stryker-config', 'lib', 'base.js'] as const

const unreadable = (reason: string): string => `${UNREADABLE_DIGEST_PREFIX}${reason}`

const isStrykerConfig = (name: string): boolean => name === STRYKER_CONFIG
const isVitestConfig = (name: string): boolean => VITEST_CONFIG.test(name)
const isTsconfig = (name: string): boolean => TSCONFIG.test(name)

const CONFIG_MATCHERS: ReadonlyArray<(name: string) => boolean> = [isStrykerConfig, isVitestConfig, isTsconfig]

const isConfigFile = (name: string): boolean => CONFIG_MATCHERS.some((matches) => matches(name))

const isPackageJson = (relativePath: string): boolean =>
  relativePath === PACKAGE_JSON || relativePath.endsWith(`/${PACKAGE_JSON}`)

const isManifest = (relativePath: string): boolean =>
  !relativePath.split('/').includes('node_modules') && isPackageJson(relativePath)

const readEntry = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
  absolute: string,
): Effect.Effect<DigestFile, string> =>
  fs.readFile(absolute).pipe(
    Effect.mapError(() => unreadable(`workload file unreadable (${absolute})`)),
    Effect.map((bytes) => ({ relativePath: path.relative(cwd, absolute), bytes })),
  )

const readEntries = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
  files: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<DigestFile>, string> =>
  Effect.forEach(files, (absolute) => readEntry(fs, path, cwd, absolute))

const readOptionalEntry = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
  absolute: string,
): Effect.Effect<Option.Option<DigestFile>> =>
  fs.readFile(absolute).pipe(
    Effect.option,
    Effect.map(Option.map((bytes) => ({ relativePath: path.relative(cwd, absolute), bytes }))),
  )

const readOptionalEntries = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
  files: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<DigestFile>> =>
  Effect.forEach(files, (absolute) => readOptionalEntry(fs, path, cwd, absolute)).pipe(
    Effect.map((entries) => Arr.getSomes(entries)),
  )

const configPaths = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
): Effect.Effect<ReadonlyArray<string>> =>
  fs.readDirectory(cwd).pipe(
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
    Effect.map((names) => names.filter(isConfigFile).map((name) => path.join(cwd, name))),
  )

const enterpriseManifests = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
): Effect.Effect<ReadonlyArray<string>> =>
  fs.readDirectory(cwd, { recursive: true }).pipe(
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
    Effect.map((entries) => entries.filter(isManifest).map((relativePath) => path.join(cwd, relativePath)).sort()),
  )

const toolchainPaths = (path: Path.Path, input: WorkloadDigestInput): ReadonlyArray<string> =>
  input.kind === 'repo' ? [path.join(input.sideRoot, ...CATALOG_RESOLUTION_CONFIG)] : []

const manifestPaths = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  input: WorkloadDigestInput,
): Effect.Effect<ReadonlyArray<string>> =>
  input.kind === 'repo'
    ? Effect.succeed([path.join(input.cwd, PACKAGE_JSON)])
    : enterpriseManifests(fs, path, input.cwd)

const resolvedManifest = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
  catalogs: WorkspaceCatalogs,
  absolute: string,
): Effect.Effect<DigestFile, string> =>
  Effect.gen(function*() {
    const relativePath = path.relative(cwd, absolute)
    const bytes = yield* fs.readFile(absolute).pipe(
      Effect.mapError(() => unreadable(`package manifest unreadable (${absolute})`)),
    )
    const parsed = yield* Effect.fromResult(
      Result.mapError(parseFixtureManifest(relativePath, bytes), () =>
        unreadable(`package manifest ${relativePath} does not decode`)),
    )
    const resolved = yield* Effect.fromResult(
      Result.mapError(resolveCatalogSpecs(relativePath, parsed, catalogs), (failure) =>
        unreadable(`catalog spec unresolved in ${relativePath}: ${failure.message}`)),
    )
    const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown))(resolved).pipe(
      Effect.mapError(() =>
        unreadable(`package manifest ${relativePath} does not encode`)
      ),
    )
    return { relativePath, bytes: new TextEncoder().encode(json) }
  })

const readManifests = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  input: WorkloadDigestInput,
): Effect.Effect<ReadonlyArray<DigestFile>, string> =>
  Effect.gen(function*() {
    const catalogsText = yield* fs.readFileString(path.join(input.sideRoot, PNPM_WORKSPACE)).pipe(
      Effect.mapError(() => unreadable(`${input.sideRoot}/${PNPM_WORKSPACE} unreadable`)),
    )
    const catalogs = parseWorkspaceCatalogs(catalogsText)
    const manifests = yield* manifestPaths(fs, path, input)
    return yield* Effect.forEach(manifests, (absolute) => resolvedManifest(fs, path, input.cwd, catalogs, absolute))
  })

const dedupe = (entries: ReadonlyArray<DigestFile>): ReadonlyArray<DigestFile> =>
  HashMap.toEntries(
    entries.reduce(
      (map, entry) => HashMap.set(map, entry.relativePath, entry.bytes),
      HashMap.empty<string, Uint8Array>(),
    ),
  )
    .map(([relativePath, bytes]) => ({ relativePath, bytes }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))

const NUL = Uint8Array.of(0)

const digestInput = (entries: ReadonlyArray<DigestFile>): Uint8Array => {
  const encoder = new TextEncoder()
  const chunks = entries.flatMap((entry) => [
    encoder.encode(entry.relativePath),
    NUL,
    encoder.encode(String(entry.bytes.byteLength)),
    NUL,
    entry.bytes,
    NUL,
  ])
  const buffer = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
  chunks.reduce((offset, chunk) => {
    buffer.set(chunk, offset)
    return offset + chunk.byteLength
  }, 0)
  return buffer
}

const digestOf = (entries: ReadonlyArray<DigestFile>): Effect.Effect<string, string, Crypto.Crypto> =>
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    return yield* crypto.digest('SHA-256', digestInput(dedupe(entries))).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(() => unreadable('sha256 digest failed')),
    )
  })

const digestOfFound = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  input: WorkloadDigestInput,
  found: CoveringTestFilesFound,
): Effect.Effect<string, string, Crypto.Crypto> =>
  Effect.gen(function*() {
    const workload = yield* readEntries(
      fs,
      path,
      input.cwd,
      [...found.mutatedFiles, ...found.testFiles].map((file) => path.resolve(input.cwd, file)),
    )
    const configs = yield* readOptionalEntries(fs, path, input.cwd, yield* configPaths(fs, path, input.cwd))
    const toolchain = yield* readEntries(fs, path, input.cwd, toolchainPaths(path, input))
    const manifests = yield* readManifests(fs, path, input)
    return yield* digestOf([...workload, ...configs, ...toolchain, ...manifests])
  })

const digestFromReport = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  input: WorkloadDigestInput,
  reportText: string,
): Effect.Effect<string, string, Crypto.Crypto> =>
  Effect.gen(function*() {
    const covered = coveringTestFiles(CoveringTestFilesCommand.make({ report: reportText }))
    if (Result.isFailure(covered)) {
      return yield* Effect.fail(unreadable(covered.failure.reason))
    }
    return yield* digestOfFound(fs, path, input, covered.success)
  })

export const workloadDigest = (
  input: WorkloadDigestInput,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Crypto.Crypto> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const reportText = yield* fs.readFileString(input.incrementalFile).pipe(Effect.option)
    return yield* Option.match(reportText, {
      onNone: () => Effect.succeed(unreadable(`incremental report missing (${input.incrementalFile})`)),
      onSome: (text) => digestFromReport(fs, path, input, text),
    })
  }).pipe(Effect.orElseSucceed((reason) => reason))
