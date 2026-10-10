import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Num from 'effect/Number'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import { type CostSource, FileRate, PlannedLeg, PlannedUnit, ProjectOverhead } from './Parity.schema.js'

const PlanLegsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-checker-parity/PlanLegs')
type PlanLegsTypeId = typeof PlanLegsTypeId

const UNMEASURED_MS_PER_MUTANT = 10_000
const ONE_DAY_MS = 86_400_000

const NonNegativeInt = S.Int.check(S.isGreaterThanOrEqualTo(0))
const NonNegativeFinite = S.Finite.check(S.isGreaterThanOrEqualTo(0))
const CapacityMs = S.Finite.check(S.isBetween({ minimum: 0, maximum: ONE_DAY_MS, exclusiveMinimum: true }))
const BlockMutants = S.Int.check(S.isBetween({ minimum: 1, maximum: 4096 }))

export class CorpusFile extends S.Class<CorpusFile>('CorpusFile')({
  project: S.String,
  fileName: S.String,
  mutants: NonNegativeInt,
}) {}

export class PlanLegsCommand extends S.TaggedClass<PlanLegsCommand>()('PlanLegsCommand', {
  files: S.Array(CorpusFile),
  rates: S.Array(FileRate),
  overheads: S.Array(ProjectOverhead),
  capacityMs: CapacityMs,
  blockMutants: BlockMutants,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class LegsPlanned extends S.TaggedClass<LegsPlanned>()('LegsPlanned', {
  legs: S.NonEmptyArray(PlannedLeg),
  totalMs: NonNegativeFinite,
}) {
  readonly [PlanLegsTypeId] = PlanLegsTypeId
}

export class NoCorpusMutants extends S.TaggedClass<NoCorpusMutants>()('NoCorpusMutants', {}) {
  readonly [PlanLegsTypeId] = PlanLegsTypeId
}

export const PlanLegsDecision = S.Union([LegsPlanned, NoCorpusMutants])
export type PlanLegsDecision = typeof PlanLegsDecision.Type

interface Keyed {
  readonly project: string
  readonly fileName: string
}

interface Estimate {
  readonly msPerMutant: number
  readonly source: CostSource
}

interface RateSample {
  readonly project: string
  readonly fileName: string
  readonly msPerMutant: number
  readonly mutants: number
}

interface Draft {
  readonly fromBlock: number
  readonly toBlock: number
  readonly mutants: number
  readonly ms: number
}

interface Cut {
  readonly closed: ReadonlyArray<Draft>
  readonly open: Option.Option<Draft>
}

interface LegDraft {
  readonly leg: number
  readonly ms: number
  readonly projects: HashSet.HashSet<string>
  readonly units: Arr.NonEmptyArray<PlannedUnit>
}

const keyOf = (file: Keyed): string => `${file.project.length}:${file.project}${file.fileName}`

const mergeFile = (kept: HashMap.HashMap<string, CorpusFile>, file: CorpusFile): HashMap.HashMap<string, CorpusFile> =>
  HashMap.set(
    kept,
    keyOf(file),
    CorpusFile.make({
      project: file.project,
      fileName: file.fileName,
      mutants: Num.max(
        file.mutants,
        Option.getOrElse(Option.map(HashMap.get(kept, keyOf(file)), (existing) => existing.mutants), () => 0),
      ),
    }),
  )

const dedupedFiles = (files: ReadonlyArray<CorpusFile>): ReadonlyArray<CorpusFile> =>
  Arr.filter(HashMap.toValues(files.reduce(mergeFile, HashMap.empty<string, CorpusFile>())), (file) => file.mutants > 0)

const mergeSample = (kept: HashMap.HashMap<string, RateSample>, rate: FileRate): HashMap.HashMap<string, RateSample> =>
  HashMap.set(
    kept,
    keyOf(rate),
    Option.match(HashMap.get(kept, keyOf(rate)), {
      onNone: () => ({
        project: rate.project,
        fileName: rate.fileName,
        msPerMutant: rate.msPerMutant,
        mutants: rate.mutants,
      }),
      onSome: (existing) => ({
        project: rate.project,
        fileName: rate.fileName,
        msPerMutant: Num.max(existing.msPerMutant, rate.msPerMutant),
        mutants: Num.max(existing.mutants, rate.mutants),
      }),
    }),
  )

const mergeOverhead = (
  kept: HashMap.HashMap<string, number>,
  overhead: ProjectOverhead,
): HashMap.HashMap<string, number> =>
  HashMap.set(
    kept,
    overhead.project,
    Num.max(overhead.ms, Option.getOrElse(HashMap.get(kept, overhead.project), () => 0)),
  )

const weightedMean = (samples: ReadonlyArray<RateSample>): number =>
  samples.reduce((total, sample) => total + sample.msPerMutant * sample.mutants, 0) /
  samples.reduce((total, sample) => total + sample.mutants, 0)

const draftOf = (index: number, mutants: number, blockMutants: number, msPerMutant: number): Draft => {
  const size = Num.min(blockMutants, mutants - index * blockMutants)
  return { fromBlock: index, toBlock: index + 1, mutants: size, ms: size * msPerMutant }
}

const step = (cut: Cut, block: Draft, overhead: number, capacityMs: number): Cut =>
  Option.match(cut.open, {
    onNone: () => ({ closed: cut.closed, open: Option.some(block) }),
    onSome: (open) =>
      Boolean.match(open.ms + block.ms + overhead <= capacityMs, {
        onTrue: () => ({
          closed: cut.closed,
          open: Option.some({
            fromBlock: open.fromBlock,
            toBlock: block.toBlock,
            mutants: open.mutants + block.mutants,
            ms: open.ms + block.ms,
          }),
        }),
        onFalse: () => ({ closed: [...cut.closed, open], open: Option.some(block) }),
      }),
  })

const unitsOf = (
  command: PlanLegsCommand,
  file: CorpusFile,
  estimate: Estimate,
  overhead: number,
): ReadonlyArray<PlannedUnit> => {
  const remainder = file.mutants % command.blockMutants
  const blockCount = (file.mutants - remainder) / command.blockMutants + Number(remainder > 0)
  const before: Cut = { closed: Arr.empty<Draft>(), open: Option.none<Draft>() }
  const cut = Arr.reduce(
    Arr.range(0, blockCount - 1),
    before,
    (state, index) =>
      step(
        state,
        draftOf(index, file.mutants, command.blockMutants, estimate.msPerMutant),
        overhead,
        command.capacityMs,
      ),
  )
  return [...cut.closed, ...Option.toArray(cut.open)].map((draft) =>
    PlannedUnit.make({
      project: file.project,
      fileName: file.fileName,
      fromBlock: draft.fromBlock,
      toBlock: draft.toBlock,
      mutants: draft.mutants,
      fileMutants: file.mutants,
      ms: draft.ms,
      source: estimate.source,
    })
  )
}

const unitOrder: Order.Order<PlannedUnit> = Order.combine(
  Order.combine(
    Order.mapInput(Order.flip(Order.Number), (unit: PlannedUnit) => unit.ms),
    Order.mapInput(Str.Order, (unit: PlannedUnit) => unit.project),
  ),
  Order.combine(
    Order.mapInput(Str.Order, (unit: PlannedUnit) => unit.fileName),
    Order.mapInput(Order.Number, (unit: PlannedUnit) => unit.fromBlock),
  ),
)

const unitInLegOrder: Order.Order<PlannedUnit> = Order.combine(
  Order.combine(
    Order.mapInput(Str.Order, (unit: PlannedUnit) => unit.project),
    Order.mapInput(Str.Order, (unit: PlannedUnit) => unit.fileName),
  ),
  Order.mapInput(Order.Number, (unit: PlannedUnit) => unit.fromBlock),
)

const extraMs = (leg: LegDraft, project: string, overheadOf: (project: string) => number): number =>
  Number(!HashSet.has(leg.projects, project)) * overheadOf(project)

const singleUnit = (unit: PlannedUnit): Arr.NonEmptyArray<PlannedUnit> => [unit]

const pack = (
  legs: ReadonlyArray<LegDraft>,
  unit: PlannedUnit,
  overheadOf: (project: string) => number,
  capacityMs: number,
): ReadonlyArray<LegDraft> =>
  Option.match(
    Arr.findFirstIndex(legs, (leg) => leg.ms + unit.ms + extraMs(leg, unit.project, overheadOf) <= capacityMs),
    {
      onSome: (index) =>
        Arr.map(legs, (leg, position) =>
          Boolean.match(position === index, {
            onTrue: () => ({
              leg: leg.leg,
              ms: leg.ms + unit.ms + extraMs(leg, unit.project, overheadOf),
              projects: HashSet.add(leg.projects, unit.project),
              units: [...leg.units, unit],
            }),
            onFalse: () => leg,
          })),
      onNone: () => [
        ...legs,
        {
          leg: legs.length + 1,
          ms: overheadOf(unit.project) + unit.ms,
          projects: HashSet.fromIterable([unit.project]),
          units: singleUnit(unit),
        },
      ],
    },
  )

const planOf = (command: PlanLegsCommand, files: ReadonlyArray<CorpusFile>): ReadonlyArray<LegDraft> => {
  const samples = HashMap.toValues(command.rates.reduce(mergeSample, HashMap.empty<string, RateSample>()))
  const measuredRates = HashMap.fromIterable(samples.map((sample) => [keyOf(sample), sample.msPerMutant] as const))
  const projectMeans = HashMap.fromIterable(
    Object.entries(Arr.groupBy(samples, (sample) => sample.project)).map(
      ([project, owned]) => [project, weightedMean(owned)] as const,
    ),
  )
  const corpusMean = Arr.match(samples, {
    onEmpty: () => Option.none<number>(),
    onNonEmpty: (owned) => Option.some(weightedMean(owned)),
  })
  const overheadsByProject = command.overheads.reduce(mergeOverhead, HashMap.empty<string, number>())
  const maxMeasuredOverhead = Arr.match(command.overheads, {
    onEmpty: () => Option.none<number>(),
    onNonEmpty: (owned) => Option.some(owned.reduce((max, overhead) => Num.max(max, overhead.ms), 0)),
  })
  const overheadOf = (project: string): number =>
    Option.getOrElse(HashMap.get(overheadsByProject, project), () => Option.getOrElse(maxMeasuredOverhead, () => 0))
  const estimateOf = (file: CorpusFile): Estimate =>
    Option.match(HashMap.get(measuredRates, keyOf(file)), {
      onSome: (msPerMutant) => ({ msPerMutant, source: 'measured' as const }),
      onNone: () =>
        Option.match(HashMap.get(projectMeans, file.project), {
          onSome: (msPerMutant) => ({ msPerMutant, source: 'project-mean' as const }),
          onNone: () =>
            Option.match(corpusMean, {
              onSome: (msPerMutant) => ({ msPerMutant, source: 'corpus-mean' as const }),
              onNone: () => ({ msPerMutant: UNMEASURED_MS_PER_MUTANT, source: 'no-measurements' as const }),
            }),
        }),
    })
  const units = Arr.sort(
    Arr.flatMap(files, (file) => unitsOf(command, file, estimateOf(file), overheadOf(file.project))),
    unitOrder,
  )
  const empty: ReadonlyArray<LegDraft> = Arr.empty()
  return Arr.reduce(units, empty, (legs, unit) => pack(legs, unit, overheadOf, command.capacityMs))
}

const decide = (command: PlanLegsCommand): Result.Result<PlanLegsDecision, never> =>
  Result.succeed(
    Arr.match(planOf(command, dedupedFiles(command.files)), {
      onEmpty: () => NoCorpusMutants.make({}),
      onNonEmpty: (drafts) =>
        LegsPlanned.make({
          legs: Arr.map(
            drafts,
            (draft) => PlannedLeg.make({ leg: draft.leg, ms: draft.ms, units: Arr.sort(draft.units, unitInLegOrder) }),
          ),
          totalMs: drafts.reduce((total, draft) => total + draft.ms, 0),
        }),
    }),
  )

export const planLegs = Workflow.make({
  command: PlanLegsCommand,
  decision: PlanLegsDecision,
  error: S.Never,
  decide,
})
