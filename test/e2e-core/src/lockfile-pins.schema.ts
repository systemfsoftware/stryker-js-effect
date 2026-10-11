import * as Boolean from 'effect/Boolean'
import * as Function from 'effect/Function'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'
import * as S from 'effect/Schema'
import type { Json, JsonObject } from 'effect/Schema'

import { BenchSide } from './bench-run.schema.js'
import { DependencyRecord } from './catalog-resolution.schema.js'

export interface PnpmNode {
  readonly from: string
  readonly version: string
  readonly resolved?: string
  readonly path?: string
  readonly deduped?: boolean
  readonly dedupedDependenciesCount?: number
  readonly dependencies?: Readonly<Record<string, PnpmNode>>
  readonly optionalDependencies?: Readonly<Record<string, PnpmNode>>
}

export const PnpmNode = S.Struct({
  from: S.String,
  version: S.String,
  resolved: S.optionalKey(S.String),
  path: S.optionalKey(S.String),
  deduped: S.optionalKey(S.Boolean),
  dedupedDependenciesCount: S.optionalKey(S.Natural),
  dependencies: S.optionalKey(S.Record(S.String, S.suspend((): S.Codec<PnpmNode> => PnpmNode))),
  optionalDependencies: S.optionalKey(S.Record(S.String, S.suspend((): S.Codec<PnpmNode> => PnpmNode))),
}).annotate({ identifier: 'PnpmNode' })

export const PnpmProject = S.Struct({
  name: S.String,
  version: S.String,
  path: S.String,
  private: S.optionalKey(S.Boolean),
  dependencies: S.optionalKey(S.Record(S.String, PnpmNode)),
  devDependencies: S.optionalKey(S.Record(S.String, PnpmNode)),
  optionalDependencies: S.optionalKey(S.Record(S.String, PnpmNode)),
})
export type PnpmProject = typeof PnpmProject.Type

export const PnpmListing = S.Array(PnpmProject)
export type PnpmListing = typeof PnpmListing.Type

export const PnpmListingJson = S.fromJsonString(PnpmListing)

const LockfilePinsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/LockfilePins')
type LockfilePinsTypeId = typeof LockfilePinsTypeId

export class LockfilePinsResolved extends S.TaggedClass<LockfilePinsResolved>()('LockfilePinsResolved', {
  pins: S.Record(S.String, S.String),
}) {
  readonly [LockfilePinsTypeId] = LockfilePinsTypeId
}

export class LockfilePinsPartial extends S.TaggedClass<LockfilePinsPartial>()('LockfilePinsPartial', {
  pins: S.Record(S.String, S.String),
  withheld: S.NonEmptyArray(S.String),
}) {
  readonly [LockfilePinsTypeId] = LockfilePinsTypeId
}

export const LockfilePins = S.Union([LockfilePinsResolved, LockfilePinsPartial])
export type LockfilePins = typeof LockfilePins.Type

export const WithheldPins = S.Struct({
  side: BenchSide,
  cutoff: S.NonEmptyString,
  names: S.NonEmptyArray(S.String),
})
export type WithheldPins = typeof WithheldPins.Type

const EnterpriseInstallTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/EnterpriseInstall')
type EnterpriseInstallTypeId = typeof EnterpriseInstallTypeId

export class EnterpriseInstallExact extends S.TaggedClass<EnterpriseInstallExact>()('EnterpriseInstallExact', {
  argv: S.NonEmptyArray(S.String),
}) {
  readonly [EnterpriseInstallTypeId] = EnterpriseInstallTypeId
}

export class EnterpriseInstallBounded extends S.TaggedClass<EnterpriseInstallBounded>()('EnterpriseInstallBounded', {
  argv: S.NonEmptyArray(S.String),
  withheld: WithheldPins,
}) {
  readonly [EnterpriseInstallTypeId] = EnterpriseInstallTypeId
}

export const EnterpriseInstall = S.Union([EnterpriseInstallExact, EnterpriseInstallBounded])
export type EnterpriseInstall = typeof EnterpriseInstall.Type

const ROOT_MANIFEST_PATH = 'package.json'

const sortedRecord = (record: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.keys(record).sort().map((name): readonly [string, string] => [name, record[name]]))

const pinnedEntries = (entries: Readonly<Record<string, string>>, pins: LockfilePins): Record<string, string> =>
  Object.fromEntries(
    Object.entries(entries).map(
      ([name, spec]): readonly [string, string] => [name, Option.getOrElse(Rec.get(pins.pins, name), () => spec)],
    ),
  )

const pinnedField = (value: Json, pins: LockfilePins): Option.Option<Record<string, string>> =>
  Option.map(S.decodeUnknownOption(DependencyRecord)(value), (entries) => pinnedEntries(entries, pins))

export const ManifestField = S.Literals(['dependencies', 'devDependencies', 'optionalDependencies'])

const withPinnedFields = (manifest: JsonObject, pins: LockfilePins): JsonObject =>
  ManifestField.literals.reduce<JsonObject>(
    (pinned, field) =>
      Option.match(Option.fromNullishOr(manifest[field]), {
        onNone: () => pinned,
        onSome: (value) =>
          Option.match(pinnedField(value, pins), {
            onNone: () => pinned,
            onSome: (entries) => Object.assign({}, pinned, { [field]: entries }),
          }),
      }),
    manifest,
  )

export const pinnedManifest: {
  (pins: LockfilePins, relativePath: string): (manifest: JsonObject) => JsonObject
  (manifest: JsonObject, pins: LockfilePins, relativePath: string): JsonObject
} = Function.dual(
  3,
  (manifest: JsonObject, pins: LockfilePins, relativePath: string): JsonObject => {
    const pinned = withPinnedFields(manifest, pins)
    return Boolean.match(relativePath === ROOT_MANIFEST_PATH, {
      onTrue: (): JsonObject => Object.assign({}, pinned, { overrides: sortedRecord(pins.pins) }),
      onFalse: (): JsonObject => pinned,
    })
  },
)
