import * as Boolean from 'effect/Boolean'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'
import * as S from 'effect/Schema'

import type { PackedMember } from './install-closure.schema.js'

export const NpmManifestJson = S.fromJsonString(S.Struct({
  name: S.String,
  version: S.String,
  private: S.optionalKey(S.Boolean),
  dependencies: S.optionalKey(S.Record(S.String, S.String)),
}))

const Specs = S.optionalKey(S.Record(S.String, S.String))

const Flag = S.optionalKey(S.Boolean)

const Strings = S.String.pipe(S.Array, S.optionalKey)

const NpmMetadata = S.optionalKey(S.Json)

export const NpmLockEntry = S.Struct({
  name: S.optionalKey(S.String),
  version: S.optionalKey(S.String),
  resolved: S.optionalKey(S.String),
  integrity: S.optionalKey(S.String),
  link: Flag,
  dev: Flag,
  optional: Flag,
  devOptional: Flag,
  peer: Flag,
  inBundle: Flag,
  hasInstallScript: Flag,
  hasShrinkwrap: Flag,
  bin: NpmMetadata,
  license: NpmMetadata,
  engines: NpmMetadata,
  os: Strings,
  cpu: Strings,
  libc: Strings,
  deprecated: S.optionalKey(S.String),
  funding: NpmMetadata,
  dependencies: Specs,
  optionalDependencies: Specs,
  peerDependencies: Specs,
  peerDependenciesMeta: S.optionalKey(S.Record(S.String, S.Struct({ optional: Flag }))),
  devDependencies: Specs,
  bundleDependencies: Strings,
  workspaces: Strings,
})
export type NpmLockEntry = typeof NpmLockEntry.Type

export const NpmLockfile = S.Struct({
  name: S.optionalKey(S.String),
  version: S.optionalKey(S.String),
  lockfileVersion: S.Int,
  requires: Flag,
  packages: S.Record(S.String, NpmLockEntry),
})
export type NpmLockfile = typeof NpmLockfile.Type

export const NpmLockfileJson = S.fromJsonString(NpmLockfile)

export const PinnedFixtureManifestJson = S.fromJsonString(S.Struct({
  name: S.String,
  version: S.String,
  private: S.Boolean,
  devDependencies: Specs,
  overrides: Specs,
}))

export const PackumentJson = S.fromJsonString(S.Struct({
  name: S.String,
  'dist-tags': S.Record(S.String, S.String),
  versions: S.Record(
    S.String,
    S.Struct({
      name: S.String,
      version: S.String,
      dependencies: Specs,
      peerDependencies: Specs,
      dist: S.Struct({ tarball: S.String }),
    }),
  ),
  time: S.Record(S.String, S.String),
}))

const FILE_PROTOCOL = 'file:'
const TARBALL_EXTENSION = '.tgz'
const TOP_LEVEL_PREFIX = 'node_modules/'

const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const isClosureEntry = (entry: NpmLockEntry): boolean =>
  pipe(
    Option.fromUndefinedOr(entry.resolved),
    Option.exists((resolved) => resolved.startsWith(FILE_PROTOCOL) && resolved.endsWith(TARBALL_EXTENSION)),
  )

const mapClosureEntries = (lock: NpmLockfile, f: (entry: NpmLockEntry) => NpmLockEntry): NpmLockfile => ({
  ...lock,
  packages: Rec.map(lock.packages, (entry) =>
    Boolean.match(isClosureEntry(entry), {
      onFalse: () => entry,
      onTrue: () => f(entry),
    })),
})

export const committableLockOf = (lock: NpmLockfile): NpmLockfile =>
  mapClosureEntries(lock, ({ integrity: _integrity, version: _version, ...entry }) => entry)

const topLevelNameOf = (key: string): Option.Option<string> =>
  Option.filter(
    Option.some(key.slice(TOP_LEVEL_PREFIX.length)),
    (name) => key.startsWith(TOP_LEVEL_PREFIX) && !name.includes(`/${TOP_LEVEL_PREFIX}`),
  )

const topLevelEntriesOf = (lock: NpmLockfile): ReadonlyArray<readonly [string, NpmLockEntry]> =>
  Object.entries(lock.packages).flatMap(([key, entry]) =>
    Option.toArray(Option.map(topLevelNameOf(key), (name) => [name, entry] as const))
  )

export const topLevelVersionsOf = (lock: NpmLockfile): Record<string, string> =>
  Object.fromEntries(
    topLevelEntriesOf(lock).flatMap(([name, entry]) =>
      Option.toArray(Option.map(Option.fromUndefinedOr(entry.version), (version) => [name, version] as const))
    ),
  )

export const closureEntryNamesOf = (lock: NpmLockfile): ReadonlyArray<string> =>
  topLevelEntriesOf(lock)
    .filter(([, entry]) => isClosureEntry(entry))
    .map(([name]) => name)
    .sort()

const PACKED_FIELDS = ['dependencies', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies'] as const

const packedFieldsOf = (member: PackedMember): NpmLockEntry => ({
  version: member.manifest.version,
  ...Object.fromEntries(
    PACKED_FIELDS.flatMap((field) =>
      Option.toArray(Option.map(Option.fromUndefinedOr(member.manifest[field]), (value) => [field, value] as const))
    ),
  ),
})

const withoutPackedFields = (
  {
    version: _version,
    dependencies: _dependencies,
    peerDependencies: _peerDependencies,
    peerDependenciesMeta: _peerDependenciesMeta,
    optionalDependencies: _optionalDependencies,
    ...entry
  }: NpmLockEntry,
): NpmLockEntry => entry

const memberOf = (members: ReadonlyArray<PackedMember>, entry: NpmLockEntry): Option.Option<PackedMember> =>
  Option.flatMap(
    Option.fromUndefinedOr(entry.resolved),
    (resolved) =>
      Option.fromUndefinedOr(members.find((member) => fileNameOf(member.tarballPath) === fileNameOf(resolved))),
  )

export const overlayOf = (
  input: { readonly lock: NpmLockfile; readonly members: ReadonlyArray<PackedMember> },
): NpmLockfile =>
  mapClosureEntries(input.lock, (entry) =>
    Option.match(memberOf(input.members, entry), {
      onNone: () => entry,
      onSome: (member) => ({ ...withoutPackedFields(entry), ...packedFieldsOf(member) }),
    }))
