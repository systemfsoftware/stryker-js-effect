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
  fileName: S.String,
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
  fileName: S.String,
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

export class Deferred extends S.TaggedClass<Deferred>()('Deferred', {
  schemaVersion: SCHEMA_VERSION,
  side: S.NullOr(Side),
  project: S.String,
  fileName: S.NullOr(S.String),
  mutants: NonNegativeInt,
  reason: S.Literals(['deadline-passed', 'interrupted-at-deadline']),
}) {}

export class UnitOverBudget extends S.TaggedClass<UnitOverBudget>()('UnitOverBudget', {
  schemaVersion: SCHEMA_VERSION,
  side: Side,
  project: S.String,
  fileName: S.String,
  mutantIds: S.Array(S.String),
  interrupts: PositiveInt,
  ms: NonNegativeFinite,
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
  Deferred,
  UnitOverBudget,
])
export type ParityLine = typeof ParityLine.Type

const ONE_HOUR_MS = 3_600_000
const MAX_MUTANTS = 1_000_000
const BoundedMs = S.Finite.check(S.isBetween({ minimum: 0, maximum: ONE_HOUR_MS }))
const MutantCount = S.Int.check(S.isBetween({ minimum: 1, maximum: MAX_MUTANTS }))
export const RunId = S.Int.check(S.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
export type RunId = typeof RunId.Type

export class FileRate extends S.Class<FileRate>('FileRate')({
  project: S.String,
  fileName: S.String,
  msPerMutant: BoundedMs,
  mutants: MutantCount,
  runId: RunId,
}) {}

export class ProjectOverhead extends S.Class<ProjectOverhead>('ProjectOverhead')({
  project: S.String,
  ms: BoundedMs,
  runId: RunId,
}) {}

export class FileCosts extends S.Class<FileCosts>('FileCosts')({
  schemaVersion: S.Literal(3),
  runs: S.Array(RunId),
  files: S.Array(FileRate),
  projects: S.Array(ProjectOverhead),
}) {}

export const CostSource = S.Literals(['measured', 'project-p90', 'corpus-p90', 'no-measurements'])
export type CostSource = typeof CostSource.Type

export class PlannedUnit extends S.Class<PlannedUnit>('PlannedUnit')({
  project: S.String,
  fileName: S.String,
  fromBlock: NonNegativeInt,
  toBlock: PositiveInt,
  mutants: MutantCount,
  fileMutants: MutantCount,
  ms: NonNegativeFinite,
  source: CostSource,
}) {}

export class PlannedLeg extends S.Class<PlannedLeg>('PlannedLeg')({
  leg: PositiveInt,
  ms: NonNegativeFinite,
  units: S.NonEmptyArray(PlannedUnit),
}) {}

export class ParityPlan extends S.Class<ParityPlan>('ParityPlan')({
  schemaVersion: S.Literal(1),
  deadlineSeconds: PositiveInt,
  fill: S.Finite.check(S.isBetween({ minimum: 0, maximum: 1, exclusiveMinimum: true })),
  capacityMs: NonNegativeFinite,
  blockMutants: PositiveInt,
  totalMs: NonNegativeFinite,
  legs: S.Array(PlannedLeg),
}) {}

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
