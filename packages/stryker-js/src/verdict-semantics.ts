import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'
import { EngineIdentityUnreadable, EngineManifestSchema } from './engine-identity.schema.js'

const ENGINE_PACKAGE_SPECIFIERS: readonly string[] = [
  '@systemfsoftware/stryker-js',
  '@systemfsoftware/stryker-js-vm-runner',
]

export const INCREMENTAL_CACHE_VERSION = '4'

type Json = S.Schema.Type<typeof S.Json>

type JsonObject = Record<string, Json>

export interface RunInputs {
  readonly optionsFingerprint: string
  readonly packageManifest: string
  readonly lockfile: string
  readonly nodeMajor: string
}

const PACKAGE_MANIFEST_FILE = 'package.json'

const LOCKFILE_NAMES: readonly string[] = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]

const NODE_MAJOR = globalThis.process.versions.node.split('.')[0] ?? ''

export const sha256HexOf = (content: string): string => bytesToHex(sha256(utf8ToBytes(content)))

const isJsonObject = (value: Json): value is JsonObject => Match.record(value)

const sortObject = (record: JsonObject): Json =>
  Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, sortKeys(value)]),
  )

const sortValue = (value: Json): Json =>
  Option.match(Option.liftPredicate(value, isJsonObject), {
    onSome: (record) => sortObject(record),
    onNone: () => value,
  })

const sortKeys = (value: Json): Json => (Array.isArray(value) ? value.map(sortKeys) : sortValue(value))

const canonicalJsonOf = (value: Json): Effect.Effect<string, S.SchemaError> =>
  S.encodeEffect(S.fromJsonString(S.Json))(sortKeys(value))

const withoutVersionOf = (value: Json): Json =>
  Option.match(Option.liftPredicate(value, isJsonObject), {
    onSome: (record) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'version')),
    onNone: () => value,
  })

const scopeOptionKeys: readonly string[] = ['mutate', 'since', 'mutantIds', 'dryRunOnly']

const presentationOptionKeys: readonly string[] = [
  'reporters',
  'allowConsoleColors',
  'clearTextReporter',
  'htmlReporter',
  'jsonReporter',
  'progressStreamFile',
  'thresholds',
  'surfacing',
  'warnings',
  'logLevel',
  'fileLogLevel',
]

const storageOptionKeys: readonly string[] = ['incrementalFile', 'verdictStore', 'tempDirName', 'cleanTempDir']

const unfingerprintedOptionKeys: readonly string[] = [
  ...scopeOptionKeys,
  ...presentationOptionKeys,
  ...storageOptionKeys,
]

const optionsJsonOf = (options: Options.StrykerOptions): Effect.Effect<Json, S.SchemaError> =>
  S.encodeEffect(S.fromJsonString(Options.StrykerOptionsSchema))(options).pipe(
    Effect.flatMap((encoded) => S.decodeEffect(S.fromJsonString(S.Json))(encoded)),
  )

const withoutUnfingerprintedKeys = (value: Json): Json =>
  Option.match(Option.liftPredicate(value, isJsonObject), {
    onSome: (record) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => !unfingerprintedOptionKeys.includes(key))),
    onNone: () => value,
  })

const optionsFingerprintOf = (options: Options.StrykerOptions): Effect.Effect<string, S.SchemaError> =>
  optionsJsonOf(options).pipe(Effect.map(withoutUnfingerprintedKeys), Effect.flatMap(canonicalJsonOf))

export const packageManifestInputOf = (content: string): Effect.Effect<string, never> =>
  S.decodeEffect(S.fromJsonString(S.Json))(content).pipe(
    Effect.flatMap((manifest) => {
      const stripped = withoutVersionOf(manifest)
      return canonicalJsonOf(stripped)
    }),
    Effect.orElseSucceed(() => content),
  )

const runInputsDigestOfParts = (inputs: RunInputs): string =>
  sha256HexOf([inputs.optionsFingerprint, inputs.packageManifest, inputs.lockfile, inputs.nodeMajor].join('\u0000'))

const existsAsOption = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  candidate: string,
): Effect.Effect<Option.Option<string>, never> =>
  Effect.map(
    fs.exists(candidate).pipe(Effect.orElseSucceed(() => false)),
    (exists) => Option.liftPredicate(candidate, () => exists),
  )

const findUpFrom = Effect.fnUntraced(function*(
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  dir: string,
  names: readonly string[],
): Effect.fn.Return<Option.Option<string>, never> {
  const candidates = yield* Effect.forEach(
    names,
    (name) => existsAsOption(fs, pathService, pathService.join(dir, name)),
  )
  const parent = pathService.dirname(dir)
  return yield* Option.match(Option.firstSomeOf(candidates), {
    onSome: (present) => Effect.succeedSome(present),
    onNone: () => parent === dir ? Effect.succeedNone : findUpFrom(fs, pathService, parent, names),
  })
})

const readIfPresent = (fs: FileSystem.FileSystem, file: Option.Option<string>): Effect.Effect<string, never> =>
  Option.match(file, {
    onNone: () => Effect.succeed(''),
    onSome: (present) => fs.readFileString(present).pipe(Effect.orElseSucceed(() => '')),
  })

export const runInputsDigestOf = Effect.fnUntraced(function*(
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  basePath: string,
  options: Options.StrykerOptions,
): Effect.fn.Return<string, never> {
  const packageManifest = yield* readIfPresent(
    fs,
    yield* findUpFrom(fs, pathService, basePath, [PACKAGE_MANIFEST_FILE]),
  )
  return runInputsDigestOfParts({
    optionsFingerprint: yield* optionsFingerprintOf(options).pipe(Effect.orDie),
    packageManifest: yield* packageManifestInputOf(packageManifest),
    lockfile: yield* readIfPresent(fs, yield* findUpFrom(fs, pathService, basePath, LOCKFILE_NAMES)),
    nodeMajor: NODE_MAJOR,
  })
})

const filesOfEntry = Effect.fnUntraced(function*(
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  root: string,
  entry: string,
) {
  const absolute = pathService.join(root, entry)
  const info = yield* fs.stat(absolute)
  return info.type === 'Directory'
    ? yield* Effect.filter(
      yield* fs.readDirectory(absolute, { recursive: true }),
      (name) => Effect.map(fs.stat(pathService.join(absolute, name)), (child) => child.type === 'File'),
    ).pipe(Effect.map((names) => names.map((name) => pathService.join(entry, name))))
    : [pathService.normalize(entry)]
})

export const packageDigestOf = Effect.fnUntraced(function*(
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  manifestPath: string,
): Effect.fn.Return<string, EngineIdentityUnreadable> {
  const root = pathService.dirname(manifestPath)
  return yield* Effect.gen(function*() {
    const manifestText = yield* fs.readFileString(manifestPath)
    const manifest = yield* S.decodeEffect(S.fromJsonString(EngineManifestSchema))(manifestText)
    const declared = yield* Effect.forEach(manifest.files, (entry) => filesOfEntry(fs, pathService, root, entry))
    const files = Arr.sort(Arr.dedupe(declared.flat()), Order.String)
    const contents = yield* Effect.forEach(files, (file) => fs.readFile(pathService.join(root, file)))
    const hash = sha256.create().update(utf8ToBytes(manifestText))
    Arr.zip(files, contents).forEach(([file, bytes]) => hash.update(utf8ToBytes(`\u0000${file}\u0000`)).update(bytes))
    return bytesToHex(hash.digest())
  }).pipe(Effect.mapError((cause) => EngineIdentityUnreadable.make({ manifest: manifestPath, cause })))
})

const manifestPathOf = (pathService: Path.Path, specifier: string): Effect.Effect<string, EngineIdentityUnreadable> =>
  Effect.try({
    try: () => new URL(import.meta.resolve(`${specifier}/package.json`)),
    catch: (cause) => EngineIdentityUnreadable.make({ manifest: `${specifier}/package.json`, cause }),
  }).pipe(
    Effect.flatMap((url) =>
      pathService.fromFileUrl(url).pipe(
        Effect.mapError((cause) => EngineIdentityUnreadable.make({ manifest: url.href, cause })),
      )
    ),
  )

export const engineDigestOf = Effect.fnUntraced(function*(
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
): Effect.fn.Return<string, never> {
  const digests = yield* Effect.forEach(
    ENGINE_PACKAGE_SPECIFIERS,
    (specifier) =>
      manifestPathOf(pathService, specifier).pipe(
        Effect.flatMap((manifestPath) => packageDigestOf(fs, pathService, manifestPath)),
        Effect.map((digest) => `${specifier}\u0000${digest}`),
      ),
  ).pipe(Effect.orDie)
  return sha256HexOf(digests.join('\u0000'))
})

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const withKeysTakenFromOf = (
    keys: readonly string[],
    options: Options.StrykerOptions,
    other: Options.StrykerOptions,
  ): Options.StrykerOptions =>
    Object.assign({ ...options }, Object.fromEntries(Object.entries(other).filter(([key]) => keys.includes(key))))

  const otherCoverageAnalysisOf = (
    mode: Options.StrykerOptions['coverageAnalysis'],
  ): Options.StrykerOptions['coverageAnalysis'] => (mode === 'off' ? 'perTest' : 'off')

  const otherTimeoutMSOf = (timeoutMS: number): number => (timeoutMS === 0 ? 1 : 0)

  const verdictDriftedOf = (options: Options.StrykerOptions): Options.StrykerOptions => ({
    ...options,
    testFiles: [...options.testFiles, 'test/**/*.extra.mjs'],
    coverageAnalysis: otherCoverageAnalysisOf(options.coverageAnalysis),
    timeoutMS: otherTimeoutMSOf(options.timeoutMS),
    force: !options.force,
  })

  it.effect.prop(
    '∀oo_Options_≡ScopeOptionDrawsKeepTheOptionsFingerprint',
    { of: [Options.StrykerOptionsSchema, Options.StrykerOptionsSchema], subject: optionsFingerprintOf },
    (subject, [options, other]) =>
      Effect.map(
        Effect.all([subject(options), subject(withKeysTakenFromOf(scopeOptionKeys, options, other))]),
        ([baseline, rescoped]) => rescoped === baseline,
      ),
  )

  it.effect.prop(
    '∀oo_Options_≡PresentationOptionDrawsKeepTheOptionsFingerprint',
    { of: [Options.StrykerOptionsSchema, Options.StrykerOptionsSchema], subject: optionsFingerprintOf },
    (subject, [options, other]) =>
      Effect.map(
        Effect.all([subject(options), subject(withKeysTakenFromOf(presentationOptionKeys, options, other))]),
        ([baseline, represented]) => represented === baseline,
      ),
  )

  it.effect.prop(
    '∀oo_Options_≡StorageOptionDrawsKeepTheOptionsFingerprint',
    { of: [Options.StrykerOptionsSchema, Options.StrykerOptionsSchema], subject: optionsFingerprintOf },
    (subject, [options, other]) =>
      Effect.map(
        Effect.all([subject(options), subject(withKeysTakenFromOf(storageOptionKeys, options, other))]),
        ([baseline, relocated]) => relocated === baseline,
      ),
  )

  it.effect.prop(
    '∀oo_Options_≡AnotherVerdictStoreKeepsTheOptionsFingerprint',
    { of: [Options.StrykerOptionsSchema, Options.StrykerOptionsSchema], subject: optionsFingerprintOf },
    (subject, [options, other]) =>
      Effect.map(
        Effect.all([subject(options), subject({ ...options, verdictStore: other.verdictStore })]),
        ([baseline, restored]) => restored === baseline,
      ),
  )

  it.effect.prop(
    '∀o_Options_≡AVerdictRelevantOptionMovesTheOptionsFingerprint',
    { of: [Options.StrykerOptionsSchema], subject: optionsFingerprintOf },
    (subject, [options]) =>
      Effect.map(
        Effect.all([subject(options), subject(verdictDriftedOf(options))]),
        ([baseline, drifted]) => drifted !== baseline,
      ),
  )

  const { NodeFileSystem, NodePath } = await import('@effect/platform-node')

  const SHIPPED = 'dist/chunks/run.mjs'

  const manifestOf = S.encodeEffect(S.fromJsonString(EngineManifestSchema))({ files: ['dist', 'CHANGELOG.md'] })

  const installedDigestOf = (files: ReadonlyArray<readonly [string, string]>) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'engine-identity-' })
      const manifest = yield* Effect.orDie(manifestOf)
      yield* Effect.forEach([['package.json', manifest] as const, ...files], ([file, content]) =>
        fs.makeDirectory(pathService.dirname(pathService.join(root, file)), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(pathService.join(root, file), content)),
        )).pipe(Effect.orDie)
      return yield* packageDigestOf(fs, pathService, pathService.join(root, 'package.json')).pipe(Effect.option)
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)))

  const sameDigest = Option.makeEquivalence(Str.Equivalence)

  const CHANGELOG = ['CHANGELOG.md', '## 1.0.0\n'] as const

  const sameBytes = (left: string, right: string): boolean =>
    bytesToHex(utf8ToBytes(left)) === bytesToHex(utf8ToBytes(right))

  it.effect.prop(
    '∀ss_String_≡ShippedBytesDecideThePackageDigest',
    { of: [S.String, S.String], subject: installedDigestOf },
    (subject, [shipped, rebuilt]) =>
      Effect.map(
        Effect.all([subject([CHANGELOG, [SHIPPED, shipped]]), subject([CHANGELOG, [SHIPPED, rebuilt]])]),
        ([before, after]) => Option.isSome(before) && sameDigest(before, after) === sameBytes(shipped, rebuilt),
      ),
  )

  it.effect.prop(
    '∀s_String_≡AnUnshippedFileKeepsThePackageDigest',
    { of: [S.String], subject: installedDigestOf },
    (subject, [unshipped]) =>
      Effect.map(
        Effect.all([
          subject([CHANGELOG, [SHIPPED, unshipped]]),
          subject([CHANGELOG, [SHIPPED, unshipped], ['.turbo/build.log', unshipped]]),
        ]),
        ([shippedOnly, withUnshipped]) => Option.isSome(shippedOnly) && sameDigest(withUnshipped, shippedOnly),
      ),
  )

  it.effect.prop(
    '∀s_String_≡AnUnbuiltShippedDirectoryRefusesThePackageDigest',
    { of: [S.String], subject: installedDigestOf },
    (subject, [changelog]) =>
      Effect.map(
        Effect.all([subject([['CHANGELOG.md', changelog]]), subject([['CHANGELOG.md', changelog], [SHIPPED, '']])]),
        ([unbuilt, built]) => Option.isNone(unbuilt) && Option.isSome(built),
      ),
  )
}
