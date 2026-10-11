import { Array, Function, Option, Predicate, Record } from 'effect'
import type { Json, JsonObject } from 'effect/Schema'

const FILLED_FIELDS = [
  'version',
  'bin',
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
]
const UNPINNED_FIELDS = ['integrity', 'version']
const CLOSURE_TARBALL = /^file:.*\/([^/]+\.tgz)$/

const objectOf = (json: Json | undefined): Option.Option<JsonObject> =>
  Option.liftPredicate(json, (value): value is JsonObject => Predicate.isObject(value))

const mapClosureEntries = (lock: Json, rewrite: (entry: JsonObject, tarball: string) => JsonObject): Json =>
  Option.getOrElse(
    Option.gen(function*() {
      const object = yield* objectOf(lock)
      const packages = yield* objectOf(object['packages'])
      return Object.assign({}, object, {
        packages: Record.map(packages, (entry): Json =>
          Option.getOrElse(
            Option.gen(function*() {
              const closureEntry = yield* objectOf(entry)
              const resolved = yield* Option.liftPredicate(closureEntry['resolved'], Predicate.isString)
              const tarball = yield* Array.get(CLOSURE_TARBALL.exec(resolved) ?? [], 1)
              return rewrite(closureEntry, tarball)
            }),
            () => entry,
          )),
      })
    }),
    () => lock,
  )

export const filledLockOf: {
  (manifests: Readonly<Record<string, Json>>): (lock: Json) => Json
  (lock: Json, manifests: Readonly<Record<string, Json>>): Json
} = Function.dual(
  2,
  (lock: Json, manifests: Readonly<Record<string, Json>>): Json =>
    mapClosureEntries(lock, (entry, tarball) =>
      Option.match(Option.flatMap(Record.get(manifests, tarball), objectOf), {
        onNone: () => entry,
        onSome: (manifest) =>
          Object.assign(
            Record.filter(entry, (_, key) => !FILLED_FIELDS.includes(key)),
            Record.filter(manifest, (_, key) => FILLED_FIELDS.includes(key)),
          ),
      })),
)

export const committableLockOf = (lock: Json): Json =>
  mapClosureEntries(lock, (entry) => Record.filter(entry, (_, key) => !UNPINNED_FIELDS.includes(key)))

export const withClosureDevDependencies: {
  (closure: Readonly<Record<string, string>>): (manifest: Json) => Json
  (manifest: Json, closure: Readonly<Record<string, string>>): Json
} = Function.dual(
  2,
  (manifest: Json, closure: Readonly<Record<string, string>>): Json =>
    Option.match(objectOf(manifest), {
      onNone: () => manifest,
      onSome: (object) =>
        Object.assign({}, object, {
          devDependencies: Object.assign({}, Option.getOrUndefined(objectOf(object['devDependencies'])), closure),
        }),
    }),
)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Equal = await import('effect/Equal')
  const S = await import('effect/Schema')

  const tarball = 'systemfsoftware-stryker-js.tgz'
  const resolved = `file:../../packs/${tarball}`
  const bin = { stryker: 'dist/main.mjs' }
  const lockOf = (entry: JsonObject): Json => ({ packages: { 'node_modules/@systemfsoftware/stryker-js': entry } })

  it.prop(
    '∀m_StaleClosureEntry_≡ManifestVersionDependenciesAndBin',
    { of: [S.NonEmptyString, S.NonEmptyString], subject: filledLockOf },
    (subject, [name, version]) => {
      const stale = {
        resolved,
        dev: true,
        bin,
        version: `${version}-stale`,
        dependencies: { [`dep-${name}-stale`]: '1' },
      }
      const manifest = {
        version,
        license: 'Apache-2.0',
        bin: { [name]: `dist/${name}.mjs` },
        dependencies: { [`dep-${name}`]: version },
      }
      const filled = { resolved, dev: true, bin: manifest.bin, version, dependencies: manifest.dependencies }
      return Equal.equals(subject(lockOf(stale), { [tarball]: manifest }), lockOf(filled))
    },
  )

  it.prop(
    '∀d_DependencyAbsentFromLock_∈FilledEntry',
    { of: [S.NonEmptyString, S.NonEmptyString], subject: filledLockOf },
    (subject, [name, version]) => {
      const stale = { resolved, dev: true, dependencies: { effect: '^4.0.0' } }
      const manifest = { version, dependencies: { effect: '^4.0.0', [`dep-${name}`]: version } }
      const filled = { resolved, dev: true, version, dependencies: manifest.dependencies }
      return Equal.equals(subject(lockOf(stale), { [tarball]: manifest }), lockOf(filled))
    },
  )

  it.prop(
    '∀r_RegistryEntry_≡Unchanged',
    { of: [S.NonEmptyString, S.NonEmptyString], subject: filledLockOf },
    (subject, [name, version]) => {
      const lock = lockOf({ version, resolved: `https://registry.npmjs.org/${name}.tgz`, integrity: `sha512-${name}` })
      return Equal.equals(
        subject(lock, { [tarball]: { version: '0.0.0', dependencies: { [`dep-${name}`]: '1' } } }),
        lock,
      )
    },
  )
}
