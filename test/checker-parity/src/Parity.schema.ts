/**
 * The parity driver's wire language: one NDJSON line per observation, plus the two decode-time
 * invariants the lane rests on — the {@link Side} a line belongs to, and the `k/N` {@link Shard}
 * a corpus run was sliced into.
 *
 * The driver writes these lines; `compare` decodes every `*.ndjson` under its input directories
 * through `S.fromJsonString(ParityLine)` and hands the lines to the pure `compare-sides` workflow. Every
 * line carries the repo-relative `project` (a tsconfig path, stable across sides and shards) and,
 * except {@link ProjectSkipped}, the `side` that wrote it.
 */
import * as S from 'effect/Schema'

export const Side = S.Literals(['main', 'branch'])
export type Side = typeof Side.Type

export const VerdictStatus = S.Literals(['passed', 'compileError', 'ignored'])
export type VerdictStatus = typeof VerdictStatus.Type

const NonNegativeInt = S.Int.check(S.isGreaterThanOrEqualTo(0))
const PositiveInt = S.Int.check(S.isGreaterThanOrEqualTo(1))
const NonNegativeFinite = S.Finite.check(S.isGreaterThanOrEqualTo(0))

const SCHEMA_VERSION = S.Literal(1)

/** `line` is the mutant's 1-based start line; `reason` carries the checker's status-reason text. */
export class Verdict extends S.TaggedClass<Verdict>()('Verdict', {
  schemaVersion: SCHEMA_VERSION,
  side: Side,
  project: S.String,
  mutantId: S.String,
  fileName: S.String,
  line: PositiveInt,
  status: VerdictStatus,
  reason: S.optional(S.String),
  cached: S.Boolean,
}) {}

export class CheckCall extends S.TaggedClass<CheckCall>()('CheckCall', {
  schemaVersion: SCHEMA_VERSION,
  side: Side,
  project: S.String,
  callIndex: NonNegativeInt,
  mutantIds: S.Array(S.String),
  ms: NonNegativeFinite,
  cached: S.Boolean,
}) {}

export class GroupCall extends S.TaggedClass<GroupCall>()('GroupCall', {
  schemaVersion: SCHEMA_VERSION,
  side: Side,
  project: S.String,
  ms: NonNegativeFinite,
  groups: NonNegativeInt,
  cached: S.Boolean,
}) {}

export class DigestCall extends S.TaggedClass<DigestCall>()('DigestCall', {
  schemaVersion: SCHEMA_VERSION,
  side: Side,
  project: S.String,
  ms: NonNegativeFinite,
  digest: S.String,
  cached: S.Boolean,
}) {}

export class Counts extends S.TaggedClass<Counts>()('Counts', {
  schemaVersion: SCHEMA_VERSION,
  side: Side,
  project: S.String,
  snapshotUpdates: NonNegativeInt,
  resplices: NonNegativeInt,
  tceBuilds: NonNegativeInt,
  tceMs: NonNegativeFinite,
  importerShortcuts: NonNegativeInt,
  fallbacks: S.Record(S.String, NonNegativeFinite),
  checkSpans: NonNegativeInt,
}) {}

export class ProjectBootFailed extends S.TaggedClass<ProjectBootFailed>()('ProjectBootFailed', {
  schemaVersion: SCHEMA_VERSION,
  side: Side,
  project: S.String,
  reason: S.String,
}) {}

export class ProjectSkipped extends S.TaggedClass<ProjectSkipped>()('ProjectSkipped', {
  schemaVersion: SCHEMA_VERSION,
  project: S.String,
  reason: S.String,
}) {}

export class CacheEntry extends S.TaggedClass<CacheEntry>()('CacheEntry', {
  schemaVersion: SCHEMA_VERSION,
  side: Side,
  project: S.String,
  key: S.String,
  hit: S.Boolean,
}) {}

export class TelemetryMissing extends S.TaggedClass<TelemetryMissing>()('TelemetryMissing', {
  schemaVersion: SCHEMA_VERSION,
  side: Side,
  project: S.String,
  expectedSpans: NonNegativeInt,
  receivedSpans: NonNegativeInt,
}) {}

export const ParityLine = S.Union([
  Verdict,
  CheckCall,
  GroupCall,
  DigestCall,
  Counts,
  ProjectBootFailed,
  ProjectSkipped,
  CacheEntry,
  TelemetryMissing,
])
export type ParityLine = typeof ParityLine.Type

const SHARD = /^([1-9][0-9]*)\/([1-9][0-9]*)$/u

const shardParts = (value: string): readonly [number, number] | undefined => {
  const match = SHARD.exec(value)
  return match === null ? undefined : [Number(match[1]), Number(match[2])]
}

const isShard = (value: string): boolean => {
  const parts = shardParts(value)
  return parts !== undefined && parts[0] <= parts[1]
}

export const Shard = S.String.check(
  S.makeFilter(isShard, {
    expected: 'a shard "k/N" with 1 ≤ k ≤ N and N ≥ 1',
    arbitraryConstraint: {
      patterns: [{ source: '^[1-9][0-9]*/[1-9][0-9]*$', flags: 'u' }],
    },
  }),
).pipe(S.brand('Shard'))
export type Shard = typeof Shard.Type

const partsOf = (shard: Shard): readonly [number, number] => {
  const parts = shardParts(shard)
  if (parts === undefined) {
    throw new Error(`decoded Shard "${shard}" carries no k/N parts`)
  }
  return parts
}

export const shardIndex = (shard: Shard): number => partsOf(shard)[0]

export const shardCount = (shard: Shard): number => partsOf(shard)[1]

export const Gates = S.Struct({
  shortcutCount: S.Boolean,
  speed: S.Boolean,
})
export type Gates = typeof Gates.Type
