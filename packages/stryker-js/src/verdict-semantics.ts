import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

export const VERDICT_SEMANTICS_SURFACE: readonly string[] = [
  'packages/stryker-js',
  'packages/stryker-js-instrumenter',
  'packages/stryker-js-plugin-interface',
  'packages/stryker-js-vitest-runner',
  'packages/stryker-js-typescript-checker',
  'packages/ignorers',
]

export const VERDICT_SEMANTICS_VERSION = 1

export const INCREMENTAL_CACHE_VERSION = '2'

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

const hashOf = (content: string): string => bytesToHex(sha256(utf8ToBytes(content)))

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

const optionsFingerprintOf = (options: Options.StrykerOptions): Effect.Effect<string, S.SchemaError> =>
  S.encodeEffect(S.fromJsonString(Options.StrykerOptionsSchema))(options)

const packageManifestInputOf = (content: string): Effect.Effect<string, never> =>
  S.decodeEffect(S.fromJsonString(S.Json))(content).pipe(
    Effect.flatMap((manifest) => {
      const stripped = withoutVersionOf(manifest)
      return canonicalJsonOf(stripped)
    }),
    Effect.orElseSucceed(() => content),
  )

const runInputsDigestOfParts = (inputs: RunInputs): string =>
  hashOf([inputs.optionsFingerprint, inputs.packageManifest, inputs.lockfile, inputs.nodeMajor].join('\u0000'))

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
