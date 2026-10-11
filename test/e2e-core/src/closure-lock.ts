import { Array, Function, Option, Predicate, Record } from 'effect'
import type { Json, JsonObject } from 'effect/Schema'

const FILLED_FIELDS = ['version', 'dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta']
const UNPINNED_FIELDS = ['integrity', 'version']
const CLOSURE_TARBALL = /^file:.*\/([^/]+\.tgz)$/

const objectOf = (json: Json | undefined): Option.Option<JsonObject> =>
  Option.liftPredicate(json, (value): value is JsonObject => Predicate.isObject(value))

const pick = (object: JsonObject, keep: (key: string) => boolean): JsonObject =>
  Record.filter(object, (_, key) => keep(key))

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
            pick(entry, (key) => !FILLED_FIELDS.includes(key)),
            pick(manifest, (key) => FILLED_FIELDS.includes(key)),
          ),
      })),
)

export const committableLockOf = (lock: Json): Json =>
  mapClosureEntries(lock, (entry) => pick(entry, (key) => !UNPINNED_FIELDS.includes(key)))

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
