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
import { parseDocument, stringify } from 'yaml'
import { EngineIdentityUnreadable, EngineManifestSchema } from './engine-identity.schema.js'
import {
  InstallSettingsRead,
  InstallSettingsUnreadable,
  LockfileClosure,
  lockfileClosure,
  LockfileClosureCommand,
  type LockfileClosureDecision,
  LockfileDecoded,
  LockfileUndecodable,
  NoLockfileRead,
  OtherLockfileRead,
  PnpmLockfileRead,
  WholeLockfile,
} from './lockfile-closure.workflow.js'
import {
  PackageManagerManifestSchema,
  PnpmLockfileSchema,
  type PnpmWorkspaceSettings,
  PnpmWorkspaceSettingsSchema,
} from './pnpm-lock.schema.js'

const ENGINE_PACKAGE_SPECIFIERS: readonly string[] = [
  '@systemfsoftware/stryker-js',
  '@systemfsoftware/stryker-js-vm-runner',
]

export const INCREMENTAL_CACHE_VERSION = '6'

type Json = S.Schema.Type<typeof S.Json>

type JsonObject = Record<string, Json>

export interface RunInputs {
  readonly optionsFingerprint: string
  readonly packageManifest: string
  readonly lockfile: string
  readonly nodeMajor: string
}

const PACKAGE_MANIFEST_FILE = 'package.json'

const PNPM_LOCKFILE = 'pnpm-lock.yaml'

const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml'

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

const byKey = Order.mapInput(Order.String, ([key]: readonly [string, Json]) => key)

const sortObject = (record: JsonObject): Json =>
  Object.fromEntries(Arr.sort(Object.entries(record), byKey).map(([key, value]) => [key, sortKeys(value)]))

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

const scopeOptionKeys: readonly string[] = ['mutate', 'since', 'mutantIds', 'dryRunOnly', 'plannedMutantsFile']

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

const storageOptionKeys: readonly string[] = ['incrementalFile', 'incrementalSources', 'tempDirName', 'cleanTempDir']

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

const UNPARSEABLE_YAML = 'unparseable YAML'

const yamlDecodedOf = <T, E>(schema: S.Codec<T, E>, text: string): Effect.Effect<T, string> =>
  Effect.try({
    try: () => parseDocument(text),
    catch: (cause) => (cause instanceof Error ? cause.message : UNPARSEABLE_YAML),
  }).pipe(
    Effect.flatMap((document) =>
      Option.match(Arr.head(document.errors), {
        onSome: (error) => Effect.fail(error.message),
        onNone: () => Effect.mapError(S.decodeUnknownEffect(schema)(document.toJS()), (error) => error.message),
      })
    ),
  )

const presentTextOf = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  file: string,
): Effect.Effect<Option.Option<string>, string> =>
  Effect.flatMap(existsAsOption(fs, pathService, file), (present) =>
    Option.match(present, {
      onNone: () => Effect.succeedNone,
      onSome: (path) => fs.readFileString(path).pipe(Effect.mapError((error) => error.message), Effect.asSome),
    }))

const lockfileOf = (text: string): Effect.Effect<LockfileDecoded | LockfileUndecodable, never> =>
  yamlDecodedOf(PnpmLockfileSchema, text).pipe(
    Effect.match({
      onFailure: (message) => LockfileUndecodable.make({ message }),
      onSuccess: (lockfile) => LockfileDecoded.make({ lockfile }),
    }),
  )

const workspaceSettingsOf = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  dir: string,
): Effect.Effect<PnpmWorkspaceSettings, string> =>
  Effect.flatMap(
    presentTextOf(fs, pathService, pathService.join(dir, PNPM_WORKSPACE_FILE)),
    (text) =>
      Option.match(text, {
        onNone: (): Effect.Effect<PnpmWorkspaceSettings, string> => Effect.succeed(null),
        onSome: (present) => yamlDecodedOf(PnpmWorkspaceSettingsSchema, present),
      }),
  )

const packageManagerOf = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  dir: string,
): Effect.Effect<string | null, string> =>
  Effect.flatMap(
    presentTextOf(fs, pathService, pathService.join(dir, PACKAGE_MANIFEST_FILE)),
    (text) =>
      Option.match(text, {
        onNone: (): Effect.Effect<string | null, string> => Effect.succeed(null),
        onSome: (present) =>
          S.decodeEffect(S.fromJsonString(PackageManagerManifestSchema))(present).pipe(
            Effect.mapError((error) => error.message),
            Effect.map((manifest) => manifest.packageManager ?? null),
          ),
      }),
  )

const NO_WORKSPACE_SETTINGS = {
  hoist: null,
  hoistPattern: null,
  publicHoistPattern: null,
  nodeLinker: null,
  shamefullyHoist: null,
} as const

const installSettingsOf = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  dir: string,
): Effect.Effect<InstallSettingsRead | InstallSettingsUnreadable, never> =>
  Effect.all([workspaceSettingsOf(fs, pathService, dir), packageManagerOf(fs, pathService, dir)]).pipe(
    Effect.match({
      onFailure: (message) => InstallSettingsUnreadable.make({ message }),
      onSuccess: ([workspace, packageManager]) =>
        InstallSettingsRead.make({ settings: { ...NO_WORKSPACE_SETTINGS, ...workspace, packageManager } }),
    }),
  )

const importerKeyOf = (pathService: Path.Path, lockfilePath: string, manifest: Option.Option<string>): string | null =>
  Option.getOrNull(
    Option.map(manifest, (manifestPath) => {
      const relative = pathService.relative(pathService.dirname(lockfilePath), pathService.dirname(manifestPath))
      return Option.getOrElse(
        Option.liftPredicate(relative.split(pathService.sep).join('/'), Str.isNonEmpty),
        () => '.',
      )
    }),
  )

const pnpmLockfileReadOf = Effect.fnUntraced(function*(
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  lockfilePath: string,
  text: string,
  manifest: Option.Option<string>,
): Effect.fn.Return<PnpmLockfileRead, never> {
  return PnpmLockfileRead.make({
    text,
    lockfile: yield* lockfileOf(text),
    importerKey: importerKeyOf(pathService, lockfilePath, manifest),
    installSettings: yield* installSettingsOf(fs, pathService, pathService.dirname(lockfilePath)),
  })
})

type LockfileSource = LockfileClosureCommand['source']

const lockfileCommandOf = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  lockfile: Option.Option<string>,
  manifest: Option.Option<string>,
): Effect.Effect<LockfileClosureCommand, never> =>
  Option.match(lockfile, {
    onNone: (): Effect.Effect<LockfileSource> => Effect.succeed(NoLockfileRead.make({})),
    onSome: (lockfilePath): Effect.Effect<LockfileSource> =>
      Effect.flatMap(readIfPresent(fs, lockfile), (text) =>
        Option.match(
          Option.liftPredicate(lockfilePath, (path) => pathService.basename(path) === PNPM_LOCKFILE),
          {
            onNone: (): Effect.Effect<LockfileSource> => Effect.succeed(OtherLockfileRead.make({ text })),
            onSome: (pnpmLockfile): Effect.Effect<LockfileSource> =>
              pnpmLockfileReadOf(fs, pathService, pnpmLockfile, text, manifest),
          },
        )),
  }).pipe(Effect.map((source) => LockfileClosureCommand.make({ source })))

const closureFormOf = (value: Json): Json =>
  Option.match(Option.liftPredicate(value, isJsonObject), {
    onSome: (record): Json =>
      Object.fromEntries([['form', 'closure'], ...Object.entries(record).filter(([key]) => key !== '_tag')]),
    onNone: () => value,
  })

const closureInputOf = (closure: LockfileClosure): Effect.Effect<string, S.SchemaError> =>
  S.encodeEffect(S.fromJsonString(LockfileClosure))(closure).pipe(
    Effect.flatMap((encoded) => S.decodeEffect(S.fromJsonString(S.Json))(encoded)),
    Effect.map(closureFormOf),
    Effect.flatMap(canonicalJsonOf),
  )

const fallbackWarningOf = (lockfile: Option.Option<string>, whole: WholeLockfile): Effect.Effect<void> =>
  Option.match(Option.fromNullishOr(whole.fallback), {
    onNone: () => Effect.void,
    onSome: (fallback) =>
      Effect.logWarning(
        `Run-inputs digest fell back to the whole lockfile ${
          Option.getOrElse(lockfile, () => '')
        }: ${fallback.reason} (${fallback.detail}).`,
      ),
  })

const lockfileInputOf = (
  lockfile: Option.Option<string>,
  decision: LockfileClosureDecision,
): Effect.Effect<string, never> =>
  Effect.orDie(
    Match.valueTags(decision, {
      LockfileClosure: (closure) => closureInputOf(closure),
      WholeLockfile: (whole) =>
        Effect.andThen(fallbackWarningOf(lockfile, whole), canonicalJsonOf({ form: 'whole-file', text: whole.text })),
    }),
  )

export const runInputsDigestOf = Effect.fnUntraced(function*(
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  basePath: string,
  options: Options.StrykerOptions,
): Effect.fn.Return<string, never> {
  const manifest = yield* findUpFrom(fs, pathService, basePath, [PACKAGE_MANIFEST_FILE])
  const lockfile = yield* findUpFrom(fs, pathService, basePath, LOCKFILE_NAMES)
  const command = yield* lockfileCommandOf(fs, pathService, lockfile, manifest)
  const decision = yield* Effect.fromResult(lockfileClosure(command))
  return runInputsDigestOfParts({
    optionsFingerprint: yield* optionsFingerprintOf(options).pipe(Effect.orDie),
    packageManifest: yield* packageManifestInputOf(yield* readIfPresent(fs, manifest)),
    lockfile: yield* lockfileInputOf(lockfile, decision),
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

  const reversedKeysOf = (value: Json): Json =>
    Array.isArray(value)
      ? value.map(reversedKeysOf)
      : Option.match(Option.liftPredicate(value, isJsonObject), {
        onSome: (record): Json =>
          Object.fromEntries(Object.entries(record).reverse().map(([key, entry]) => [key, reversedKeysOf(entry)])),
        onNone: () => value,
      })

  const KEY_ORDER_SEEDS: ReadonlyArray<Json> = [
    { 'é': 1, 'e\u0301': 2 },
    { b: [{ y: 1, x: 2 }], a: null },
  ]

  const seedsDigestApart = (pairs: ReadonlyArray<readonly [string, string]>): boolean =>
    Arr.dedupe(pairs.slice(0, KEY_ORDER_SEEDS.length).map(([forward]) => forward)).length === KEY_ORDER_SEEDS.length

  it.effect.prop(
    '∀j_Json_≡KeyOrderKeepsTheCanonicalJson',
    { of: [S.Json], subject: canonicalJsonOf },
    (subject, [drawn]) =>
      Effect.map(
        Effect.forEach([...KEY_ORDER_SEEDS, drawn], (value) =>
          Effect.all([subject(value), subject(reversedKeysOf(value))])),
        (pairs) =>
          pairs.every(([forward, reversed]) => forward === reversed) && seedsDigestApart(pairs),
      ),
  )

  const decisionInputOf = (decision: LockfileClosureDecision): Effect.Effect<string, never> =>
    lockfileInputOf(Option.none(), decision)

  it.effect.prop(
    '∀c_LockfileClosure_≡AWholeFileOfItsCanonicalJsonDigestsApart',
    { of: [LockfileClosure], subject: decisionInputOf },
    (subject, [closure]) =>
      Effect.flatMap(
        subject(closure),
        (input) => Effect.map(subject(WholeLockfile.make({ text: input, fallback: null })), (whole) => whole !== input),
      ),
  )

  const projectLockfileOf = (specifier: string): string =>
    JSON.stringify({
      lockfileVersion: '9.0',
      importers: { '.': {}, p: { dependencies: { q: { specifier, version: 'link:../q' } } }, q: {} },
    })

  const stagedDigestOf = (specifier: string, at: string, options: Options.StrykerOptions) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'run-inputs-' })
      yield* Effect.forEach(
        [
          ['pnpm-lock.yaml', projectLockfileOf(specifier)],
          ['p/package.json', '{ "name": "p" }'],
          ['q/package.json', '{ "name": "q" }'],
          ['p/src/math.ts', ''],
        ] as const,
        ([file, content]) =>
          fs.makeDirectory(pathService.dirname(pathService.join(root, file)), { recursive: true }).pipe(
            Effect.andThen(fs.writeFileString(pathService.join(root, file), content)),
          ),
      ).pipe(Effect.orDie)
      return yield* runInputsDigestOf(fs, pathService, pathService.join(root, at), options)
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)))

  it.effect.prop(
    '∀so_String_≡ASourceDirectoryDigestsAsItsProject',
    { of: [S.String, Options.StrykerOptionsSchema], subject: stagedDigestOf },
    (subject, [specifier, options]) =>
      Effect.map(
        Effect.all([
          subject(specifier, 'p', options),
          subject(specifier, 'p/src', options),
          subject(`${specifier}-moved`, 'p', options),
        ]),
        ([project, source, moved]) => project === source && moved !== project,
      ),
  )

  type InstallVariant = readonly [PnpmWorkspaceSettings, string]

  type DigestPair = readonly [string, string]

  type PresentSettings = NonNullable<PnpmWorkspaceSettings>

  const presentOf = (settings: PnpmWorkspaceSettings): PresentSettings => settings ?? {}

  const flippedOf = (value: boolean | undefined): boolean => !(value ?? true)

  const patternsMovedOf = (value: string | ReadonlyArray<string> | undefined): ReadonlyArray<string> => [
    ...Arr.ensure(value ?? []),
    'moved',
  ]

  const INSTALL_EDITS: ReadonlyArray<(settings: PresentSettings, packageManager: string) => InstallVariant> = [
    (settings, packageManager) => [{ ...settings, hoist: flippedOf(settings.hoist) }, packageManager],
    (
      settings,
      packageManager,
    ) => [{ ...settings, hoistPattern: patternsMovedOf(settings.hoistPattern) }, packageManager],
    (settings, packageManager) => [
      { ...settings, publicHoistPattern: patternsMovedOf(settings.publicHoistPattern) },
      packageManager,
    ],
    (settings, packageManager) => [{ ...settings, nodeLinker: `${settings.nodeLinker ?? ''}-moved` }, packageManager],
    (
      settings,
      packageManager,
    ) => [{ ...settings, shamefullyHoist: flippedOf(settings.shamefullyHoist) }, packageManager],
    (settings, packageManager) => [settings, `${packageManager}-moved`],
  ]

  const writeStaged = (root: string, file: string, content: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      yield* fs.makeDirectory(pathService.dirname(pathService.join(root, file)), { recursive: true })
      yield* fs.writeFileString(pathService.join(root, file), content)
    }).pipe(Effect.orDie)

  const stagedProjectsRoot = Effect.gen(function*() {
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'install-settings-' })
    yield* writeStaged(
      root,
      'pnpm-lock.yaml',
      stringify({ lockfileVersion: '9.0', importers: { '.': {}, p: {}, q: {} } }),
    )
    yield* writeStaged(root, 'p/package.json', '{ "name": "p" }')
    yield* writeStaged(root, 'q/package.json', '{ "name": "q" }')
    return root
  }).pipe(Effect.orDie)

  const installDigestsAt = (
    root: string,
    [settings, packageManager]: InstallVariant,
    options: Options.StrykerOptions,
  ) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const manifest = yield* S.encodeEffect(S.fromJsonString(PackageManagerManifestSchema))({ packageManager })
      yield* writeStaged(root, 'pnpm-workspace.yaml', stringify(settings))
      yield* writeStaged(root, 'package.json', manifest)
      return yield* Effect.all([
        runInputsDigestOf(fs, pathService, pathService.join(root, 'p'), options),
        runInputsDigestOf(fs, pathService, pathService.join(root, 'q'), options),
      ])
    }).pipe(Effect.orDie)

  const movedEverywhereOf = (digests: ReadonlyArray<DigestPair>): boolean =>
    Option.exists(Arr.head(digests), (base) => Arr.drop(digests, 1).every(([p, q]) => p !== base[0] && q !== base[1]))

  it.effect.prop(
    '∀wmo_PnpmWorkspaceSettings_≡EachInstallSettingEditMovesEveryProject',
    { of: [PnpmWorkspaceSettingsSchema, S.String, Options.StrykerOptionsSchema], subject: installDigestsAt },
    (subject, [settings, packageManager, options]) =>
      Effect.gen(function*() {
        const root = yield* stagedProjectsRoot
        const variants: ReadonlyArray<InstallVariant> = [
          [settings, packageManager],
          ...INSTALL_EDITS.map((edit) => edit(presentOf(settings), packageManager)),
        ]
        return movedEverywhereOf(yield* Effect.forEach(variants, (variant) => subject(root, variant, options)))
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  )
}
