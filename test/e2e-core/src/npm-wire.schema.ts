import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

import type { PackedMember } from './install-closure.schema.js'

const NPM_NAME = '(?:@[a-z0-9-*~][a-z0-9-*._~]*/)?[a-z0-9-~][a-z0-9-._~]*'

const PATH_SEGMENT = '[a-z0-9-~][a-z0-9-._~]*'

const keyOf = (pattern: string, expected: string) =>
  S.String.pipe(S.decodeTo(S.String.check(S.isPattern(new RegExp(`^(?:${pattern})$`), { expected }))))

const NpmPackageName = keyOf(NPM_NAME, 'an npm package name')

const NpmLockPath = keyOf(
  `|node_modules/${NPM_NAME}(?:/node_modules/${NPM_NAME})*|${PATH_SEGMENT}(?:/${PATH_SEGMENT})*`,
  'an npm lock package path',
)

const NamedSpecs = S.Record(NpmPackageName, S.String)

export const NpmManifestJson = S.fromJsonString(S.Struct({
  name: S.String,
  version: S.String,
  private: S.optionalKey(S.Boolean),
  dependencies: S.optionalKey(NamedSpecs),
  devDependencies: S.optionalKey(NamedSpecs),
}))

const Specs = S.optionalKey(NamedSpecs)

const Flag = S.optionalKey(S.Boolean)

const Strings = S.String.pipe(S.Array, S.optionalKey)

const FundingSource = S.Union([S.String, S.Struct({ type: S.optionalKey(S.String), url: S.String })])

const Funding = S.Union([FundingSource, S.Array(FundingSource)])

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
  bin: S.optionalKey(S.Record(NpmPackageName, S.String)),
  license: S.optionalKey(S.String),
  engines: Specs,
  os: Strings,
  cpu: Strings,
  libc: Strings,
  deprecated: S.optionalKey(S.String),
  funding: S.optionalKey(Funding),
  dependencies: Specs,
  optionalDependencies: Specs,
  peerDependencies: Specs,
  peerDependenciesMeta: S.optionalKey(S.Record(NpmPackageName, S.Struct({ optional: Flag }))),
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
  packages: S.Record(NpmLockPath, NpmLockEntry),
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

/**
 * `npm ls --json`'s report, byte for byte: an optional problem list and an optional
 * error object. The producer's optionals stay on the Encoded side; {@link LockListingJson}
 * decodes them into the union of cases this codebase distinguishes.
 */
const NpmLsReportJson = S.fromJsonString(S.Struct({
  problems: S.String.pipe(S.Array, S.optionalKey),
  error: S.optionalKey(S.Struct({ code: S.optionalKey(S.String), summary: S.optionalKey(S.String) })),
}))

type NpmLsReport = typeof NpmLsReportJson.Type

const LockProblemReport = S.TaggedStruct('LockProblemReport', {
  problems: S.NonEmptyArray(S.String),
})

const LockUnreadableReport = S.TaggedStruct('LockUnreadableReport', {
  detail: S.String,
})

export const LockListing = S.Union([LockProblemReport, LockUnreadableReport])
export type LockListing = typeof LockListing.Type

const errorDetailOf = (report: NpmLsReport): string =>
  Option.match(Option.fromUndefinedOr(report.error), {
    onNone: () => '',
    onSome: (error) => [error.code, error.summary].filter((part) => part !== undefined).join(': '),
  })

const lockListingOf = (report: NpmLsReport): LockListing =>
  Option.fromUndefinedOr(report.problems).pipe(
    Option.filter(Arr.isReadonlyArrayNonEmpty),
    Option.match({
      onSome: (problems): LockListing => ({ _tag: 'LockProblemReport', problems }),
      onNone: (): LockListing => ({ _tag: 'LockUnreadableReport', detail: errorDetailOf(report) }),
    }),
  )

const reportOf = (listing: LockListing): NpmLsReport =>
  Match.value(listing).pipe(
    Match.tag('LockProblemReport', ({ problems }): NpmLsReport => ({ problems })),
    Match.tag('LockUnreadableReport', ({ detail }): NpmLsReport => ({ error: { summary: detail } })),
    Match.exhaustive,
  )

export const LockListingJson = S.decodeTo<typeof LockListing, typeof NpmLsReportJson>(
  LockListing,
  SchemaTransformation.transform({ decode: lockListingOf, encode: reportOf }),
)(NpmLsReportJson)

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
