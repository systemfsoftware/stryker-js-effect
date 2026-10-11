import { Array, Function, Option, Predicate, Record } from 'effect'
import type { Json, JsonObject } from 'effect/Schema'

const ARBORIST_PKG_META_KEYS_FROM_MANIFEST: ReadonlyArray<string> = [
  'version',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
  'bundleDependencies',
  'acceptDependencies',
  'funding',
  'engines',
  'os',
  'cpu',
  'libc',
  'license',
  'bin',
  'deprecated',
  'workspaces',
]

const UNPINNED_FIELDS: ReadonlyArray<string> = ['integrity', 'version']

const CLOSURE_TARBALL = /^file:(?:.*\/)?([^/]+\.tgz)$/

const EMPTY_OBJECT: JsonObject = {}

const isJsonObject = (json: Json | undefined): json is JsonObject => Predicate.isObject(json)

const fieldsWhere = (source: JsonObject, keep: (key: string) => boolean): JsonObject =>
  Object.fromEntries(Object.entries(source).filter(([key]) => keep(key)))

const tarballOf = (entry: JsonObject): Option.Option<string> =>
  Function.pipe(
    Option.liftPredicate(entry['resolved'], Predicate.isString),
    Option.flatMap((resolved) => Option.fromNullishOr(CLOSURE_TARBALL.exec(resolved))),
    Option.flatMap((match) => Array.get(match, 1)),
  )

const rewriteEntryWith = (rewrite: (entry: JsonObject, tarball: string) => JsonObject) => (entry: Json): Json =>
  Option.getOrElse(
    Option.flatMap(
      Option.liftPredicate(entry, isJsonObject),
      (object) => Option.map(tarballOf(object), (tarball) => rewrite(object, tarball)),
    ),
    () => entry,
  )

const rewriteClosureEntries = (lock: Json, rewrite: (entry: JsonObject, tarball: string) => JsonObject): Json =>
  Option.getOrElse(
    Option.flatMap(Option.liftPredicate(lock, isJsonObject), (object) =>
      Option.map(
        Option.liftPredicate(object['packages'], isJsonObject),
        (packages): Json => Object.assign({}, object, { packages: Record.map(packages, rewriteEntryWith(rewrite)) }),
      )),
    () => lock,
  )

export const filledLockOf: {
  (manifests: Readonly<Record<string, Json>>): (lock: Json) => Json
  (lock: Json, manifests: Readonly<Record<string, Json>>): Json
} = Function.dual(
  2,
  (lock: Json, manifests: Readonly<Record<string, Json>>): Json =>
    rewriteClosureEntries(
      lock,
      (entry, tarball) =>
        Option.match(Option.filter(Record.get(manifests, tarball), isJsonObject), {
          onNone: () => entry,
          onSome: (manifest) =>
            Object.assign(
              {},
              fieldsWhere(entry, (key) => !ARBORIST_PKG_META_KEYS_FROM_MANIFEST.includes(key)),
              fieldsWhere(manifest, (key) => ARBORIST_PKG_META_KEYS_FROM_MANIFEST.includes(key)),
            ),
        }),
    ),
)

export const committableLockOf = (lock: Json): Json =>
  rewriteClosureEntries(lock, (entry) => fieldsWhere(entry, (key) => !UNPINNED_FIELDS.includes(key)))

export const withClosureDevDependencies: {
  (closure: Readonly<Record<string, string>>): (manifest: Json) => Json
  (manifest: Json, closure: Readonly<Record<string, string>>): Json
} = Function.dual(
  2,
  (manifest: Json, closure: Readonly<Record<string, string>>): Json =>
    Option.getOrElse(
      Option.map(Option.liftPredicate(manifest, isJsonObject), (object): Json =>
        Object.assign({}, object, {
          devDependencies: Object.assign(
            {},
            Option.getOrElse(Option.liftPredicate(object['devDependencies'], isJsonObject), () => EMPTY_OBJECT),
            closure,
          ),
        })),
      () => manifest,
    ),
)
