import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

const RestOfEntry = [S.Record(S.String, S.Json)] as const

export const PnpmImporterDependencySchema = S.StructWithRest(
  S.Struct({ specifier: S.String, version: S.String }),
  RestOfEntry,
)
export type PnpmImporterDependency = typeof PnpmImporterDependencySchema.Type

const ImporterDependencies = S.optionalKey(S.Record(S.String, PnpmImporterDependencySchema))

export const PnpmImporterSchema = S.StructWithRest(
  S.Struct({
    dependencies: ImporterDependencies,
    devDependencies: ImporterDependencies,
    optionalDependencies: ImporterDependencies,
  }),
  RestOfEntry,
)
export type PnpmImporter = typeof PnpmImporterSchema.Type

const SnapshotDependencies = S.optionalKey(S.Record(S.String, S.String))

export const PnpmSnapshotSchema = S.StructWithRest(
  S.Struct({ dependencies: SnapshotDependencies, optionalDependencies: SnapshotDependencies }),
  RestOfEntry,
)
export type PnpmSnapshot = typeof PnpmSnapshotSchema.Type

export const PnpmLockfileSchema = S.Struct({
  lockfileVersion: S.String,
  settings: S.optionalKey(S.Record(S.String, S.Json)),
  importers: S.Record(S.String, PnpmImporterSchema),
  packages: S.optionalKey(S.Record(S.String, S.Json)),
  snapshots: S.optionalKey(S.Record(S.String, PnpmSnapshotSchema)),
})
export type PnpmLockfile = typeof PnpmLockfileSchema.Type

const HoistPatterns = S.optionalKey(S.Union([S.String, S.Array(S.String)]))

export const PnpmWorkspaceSettingsSchema = S.NullOr(S.Struct({
  hoist: S.optionalKey(S.Boolean),
  hoistPattern: HoistPatterns,
  publicHoistPattern: HoistPatterns,
  nodeLinker: S.optionalKey(S.String),
  shamefullyHoist: S.optionalKey(S.Boolean),
}))
export type PnpmWorkspaceSettings = typeof PnpmWorkspaceSettingsSchema.Type

export const PackageManagerManifestSchema = S.Struct({ packageManager: S.optionalKey(S.String) })
export type PackageManagerManifest = typeof PackageManagerManifestSchema.Type

export class LinkRef extends S.TaggedClass<LinkRef>()('LinkRef', { target: S.String }) {}

export class SnapshotRef extends S.TaggedClass<SnapshotRef>()('SnapshotRef', { key: S.String }) {}

export const LockRefSchema = S.Union([LinkRef, SnapshotRef])
export type LockRef = typeof LockRefSchema.Type

const LINK_PREFIX = 'link:'

const NOT_FOUND = -1

const precedes = (at: number, other: number): boolean => Boolean.or(other === NOT_FOUND, at < other)

const namesItsSnapshot = (ref: string): boolean => {
  const at = ref.indexOf('@')
  return Boolean.or(
    ref.startsWith('@'),
    Boolean.every([at !== NOT_FOUND, precedes(at, ref.indexOf(':')), precedes(at, ref.indexOf('('))]),
  )
}

const snapshotKeyOf = (name: string, ref: string): string =>
  Boolean.match(namesItsSnapshot(ref), { onTrue: () => ref, onFalse: () => `${name}@${ref}` })

export const lockRefOf: {
  (name: string): (ref: string) => LockRef
  (ref: string, name: string): LockRef
} = dual(
  2,
  (ref: string, name: string): LockRef =>
    Boolean.match(ref.startsWith(LINK_PREFIX), {
      onTrue: (): LockRef => LinkRef.make({ target: ref.slice(LINK_PREFIX.length) }),
      onFalse: (): LockRef => SnapshotRef.make({ key: snapshotKeyOf(name, ref) }),
    }),
)

export const packageKeyOf = (snapshot: SnapshotRef): string =>
  Option.match(Option.liftPredicate(snapshot.key.indexOf('('), (at) => at !== NOT_FOUND), {
    onNone: () => snapshot.key,
    onSome: (at) => snapshot.key.slice(0, at),
  })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const sameRef = S.toEquivalence(LockRefSchema)

  const PATCHED_SNAPSHOT =
    '@systemfsoftware/differential-spec@1.0.1(patch_hash=e976436ae352fe9fcf978ef1d4dabae26df9728372562b28e5ca60d7cde9f9ee)(redis@6.2.1(@opentelemetry/api@1.9.1))(vitest@5.0.1)'

  const PINNED_REFS: ReadonlyArray<readonly [string, string, LockRef]> = [
    ['x', '1.0.0', SnapshotRef.make({ key: 'x@1.0.0' })],
    ['c', '21.2.2(@types/node@24.13.3)', SnapshotRef.make({ key: 'c@21.2.2(@types/node@24.13.3)' })],
    ['@std/jsonc', '@jsr/std__jsonc@1.0.2', SnapshotRef.make({ key: '@jsr/std__jsonc@1.0.2' })],
    ['@oracle/scoped-alias', '@types/ms@0.7.34', SnapshotRef.make({ key: '@types/ms@0.7.34' })],
    ['plain-alias', 'is-odd@3.0.1', SnapshotRef.make({ key: 'is-odd@3.0.1' })],
    [
      '@systemfsoftware/stryker-js-vm-runner',
      '@systemfsoftware/stryker-js-vitest-runner@file:.sfs-deps/stryker-js-vitest-runner.tgz(@opentelemetry/api@1.9.1)',
      SnapshotRef.make({
        key:
          '@systemfsoftware/stryker-js-vitest-runner@file:.sfs-deps/stryker-js-vitest-runner.tgz(@opentelemetry/api@1.9.1)',
      }),
    ],
    [
      'released-stryker-js-cli-contract',
      '@systemfsoftware/stryker-js-cli-contract@file:.sfs-deps/stryker-js-cli-contract.tgz',
      SnapshotRef.make({ key: '@systemfsoftware/stryker-js-cli-contract@file:.sfs-deps/stryker-js-cli-contract.tgz' }),
    ],
    ['@s/x', 'file:.sfs-deps/x.tgz(peer@1.0.0)', SnapshotRef.make({ key: '@s/x@file:.sfs-deps/x.tgz(peer@1.0.0)' })],
    ['local-tgz', 'file:vendor/local-tgz.tgz', SnapshotRef.make({ key: 'local-tgz@file:vendor/local-tgz.tgz' })],
    [
      'kleur',
      '4.1.5(patch_hash=0bbd9558fec073b55451a29158acf21d37fdf21e1b3d51c840f14d538f4b9655)',
      SnapshotRef.make({
        key: 'kleur@4.1.5(patch_hash=0bbd9558fec073b55451a29158acf21d37fdf21e1b3d51c840f14d538f4b9655)',
      }),
    ],
    ['a', 'link:../b', LinkRef.make({ target: '../b' })],
  ]

  const withoutParens = (text: string): string => text.replaceAll('(', '').replaceAll(')', '')

  const withoutAtOrColon = (text: string): string => text.replaceAll('@', '').replaceAll(':', '')

  it.prop(
    '∀v_LockRef_≡PnpmRefToRelative',
    { of: [S.String, S.String], subject: lockRefOf },
    (subject, [name, version]) =>
      Boolean.every([
        Arr.every(PINNED_REFS, ([pinnedName, ref, expected]) => sameRef(subject(ref, pinnedName), expected)),
        sameRef(
          subject(withoutAtOrColon(version), name),
          SnapshotRef.make({ key: `${name}@${withoutAtOrColon(version)}` }),
        ),
        sameRef(subject(`${LINK_PREFIX}${version}`, name), LinkRef.make({ target: version })),
      ]),
  )

  it.prop(
    '∀k_PackageKey_≡KeyWithoutTrailingGroups',
    { of: [S.String, S.String], subject: packageKeyOf },
    (subject, [key, peer]) => {
      const base = withoutParens(key)
      const group = withoutParens(peer)
      const keyOf = (text: string): SnapshotRef => SnapshotRef.make({ key: text })
      return Boolean.every([
        subject(keyOf(`${base}(${group})(${group}(${group}))`)) === base,
        subject(keyOf(base)) === base,
        subject(keyOf(subject(keyOf(key)))) === subject(keyOf(key)),
        subject(keyOf(PATCHED_SNAPSHOT)) === '@systemfsoftware/differential-spec@1.0.1',
      ])
    },
  )
}
