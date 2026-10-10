/**
 * The parity driver's wire language: one NDJSON line per observation, plus the two decode-time
 * invariants the lane rests on — the {@link Side} a line belongs to, and the `k/N` {@link Shard}
 * a corpus run was sliced into.
 *
 * The driver writes these lines; `compare` decodes every `*.ndjson` under its input directories
 * through `S.fromJsonString(ParityLine)` and hands the lines to the pure `compare-sides` workflow. Every
 * line carries the repo-relative `project` (a tsconfig path, stable across sides and shards); the kinds
 * that record a side write it.
 */
import { TypeAnswer } from '@systemfsoftware/stryker-js-plugin-interface/type-query'
import * as Arr from 'effect/Array'
import { dual } from 'effect/Function'
import * as Hash from 'effect/Hash'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

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

export class TypeAnswerLine extends S.TaggedClass<TypeAnswerLine>()('TypeAnswerLine', {
  schemaVersion: SCHEMA_VERSION,
  side: S.Literal('branch'),
  project: S.String,
  mutantId: S.String,
  fileName: S.String,
  line: PositiveInt,
  column: PositiveInt,
  candidate: S.String,
  siteType: S.optional(S.String),
  contextualType: S.optional(S.String),
  answer: TypeAnswer,
}) {}

export const TypeQueryRefusalReason = S.Literals([
  'not-in-project',
  'server-crashed',
  'unsupported-version',
  'project-open-failed',
])
export type TypeQueryRefusalReason = typeof TypeQueryRefusalReason.Type

export class TypeQueryFileRefused extends S.TaggedClass<TypeQueryFileRefused>()('TypeQueryFileRefused', {
  schemaVersion: SCHEMA_VERSION,
  project: S.String,
  fileName: S.String,
  reason: TypeQueryRefusalReason,
  nextAction: S.String,
  mutantCount: NonNegativeInt,
}) {}

export class TypeQueryServers extends S.TaggedClass<TypeQueryServers>()('TypeQueryServers', {
  schemaVersion: SCHEMA_VERSION,
  side: S.Literal('branch'),
  project: S.String,
  peakLiveServers: NonNegativeInt,
}) {}

export const PhaseLine = S.Union([CheckCall, GroupCall, DigestCall])
export type PhaseLine = typeof PhaseLine.Type

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
  TypeAnswerLine,
  TypeQueryFileRefused,
  TypeQueryServers,
])
export type ParityLine = typeof ParityLine.Type

export const RunScopeName = S.Literals(['pr', 'full'])
export type RunScopeName = typeof RunScopeName.Type

export class ScopeSettings extends S.Class<ScopeSettings>('ScopeSettings')({
  schemaVersion: SCHEMA_VERSION,
  seed: S.String,
  driftProjects: PositiveInt,
  perProject: PositiveInt,
  perChangedFile: PositiveInt,
}) {}

export const seededOrder: {
  (values: ReadonlyArray<string>): (settings: ScopeSettings) => ReadonlyArray<string>
  (settings: ScopeSettings, values: ReadonlyArray<string>): ReadonlyArray<string>
} = dual(
  2,
  (settings: ScopeSettings, values: ReadonlyArray<string>): ReadonlyArray<string> =>
    Arr.sort(
      Arr.dedupe(values),
      Order.combine(
        Order.mapInput(Order.Number, (value: string) => Hash.string(`${settings.seed}\u0000${value}`)),
        Str.Order,
      ),
    ),
)

export class LegStarted extends S.TaggedClass<LegStarted>()('LegStarted', {
  schemaVersion: SCHEMA_VERSION,
  shard: S.String,
  scope: RunScopeName,
  settings: S.NullOr(ScopeSettings),
  projects: S.Array(S.String),
  corpusDiscoveryMs: NonNegativeFinite,
}) {}

export class LegScope extends S.TaggedClass<LegScope>()('LegScope', {
  schemaVersion: SCHEMA_VERSION,
  shard: S.String,
  scope: RunScopeName,
  settings: S.NullOr(ScopeSettings),
  changedFiles: NonNegativeInt,
  changedMutants: NonNegativeInt,
  sampledMutants: NonNegativeInt,
  checkedMutants: NonNegativeInt,
  projects: NonNegativeInt,
  cachedFiles: NonNegativeInt,
  freshFiles: NonNegativeInt,
  corpusDiscoveryMs: NonNegativeFinite,
  listAndInstrumentMs: NonNegativeFinite,
  workersMs: NonNegativeFinite,
  wallMs: NonNegativeFinite,
}) {}

export const LegFile = S.Union([LegStarted, LegScope])
export type LegFile = typeof LegFile.Type

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

const separatorOf = (shard: Shard): number => shard.indexOf('/')

export const shardIndex = (shard: Shard): number => Number(shard.slice(0, separatorOf(shard)))

export const shardCount = (shard: Shard): number => Number(shard.slice(separatorOf(shard) + 1))

export const Gates = S.Struct({
  shortcutCount: S.Boolean,
  speed: S.Boolean,
})
export type Gates = typeof Gates.Type

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  it.prop(
    '∀o_SeededOrder_≡DistinctPermutationIndependentOfInputOrder',
    { of: [ScopeSettings, S.Array(S.String)], subject: seededOrder },
    (subject, [settings, values]) => {
      const ordered = subject(settings, values)
      const reversed = subject(settings, Arr.reverse(values))
      const distinct = new Set(values)
      return Arr.every([
        ordered.length === distinct.size,
        Arr.every(ordered, (value) => distinct.has(value)),
        Arr.every(ordered, (value, index) => value === reversed[index]),
      ], (holds) => holds)
    },
  )
}
