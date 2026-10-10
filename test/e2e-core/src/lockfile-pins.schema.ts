import * as Function from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'
import * as S from 'effect/Schema'
import type { Json, JsonObject } from 'effect/Schema'

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
  resolved: S.optional(S.String),
  path: S.optional(S.String),
  deduped: S.optional(S.Boolean),
  dedupedDependenciesCount: S.optional(S.Natural),
  dependencies: S.optional(S.Record(S.String, S.suspend((): S.Codec<PnpmNode> => PnpmNode))),
  optionalDependencies: S.optional(S.Record(S.String, S.suspend((): S.Codec<PnpmNode> => PnpmNode))),
}).annotate({ identifier: 'PnpmNode' })

export const PnpmProject = S.Struct({
  name: S.String,
  version: S.String,
  path: S.String,
  private: S.optional(S.Boolean),
  dependencies: S.optional(S.Record(S.String, PnpmNode)),
  devDependencies: S.optional(S.Record(S.String, PnpmNode)),
  optionalDependencies: S.optional(S.Record(S.String, PnpmNode)),
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
}) {
  readonly [LockfilePinsTypeId] = LockfilePinsTypeId
}

export const LockfilePins = S.Union([LockfilePinsResolved, LockfilePinsPartial])
export type LockfilePins = typeof LockfilePins.Type

export const ManifestRole = S.Literals(['root', 'member'])
export type ManifestRole = typeof ManifestRole.Type

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
  (pins: LockfilePins, role: ManifestRole): (manifest: JsonObject) => JsonObject
  (manifest: JsonObject, pins: LockfilePins, role: ManifestRole): JsonObject
} = Function.dual(
  3,
  (manifest: JsonObject, pins: LockfilePins, role: ManifestRole): JsonObject => {
    const pinned = withPinnedFields(manifest, pins)
    return Match.value(role).pipe(
      Match.when('root', (): JsonObject => Object.assign({}, pinned, { overrides: sortedRecord(pins.pins) })),
      Match.when('member', (): JsonObject => pinned),
      Match.exhaustive,
    )
  },
)
