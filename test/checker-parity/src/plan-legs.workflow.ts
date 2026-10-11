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

interface Block {
  readonly project: string
  readonly fileName: string
  readonly fileMutants: number
  readonly index: number
  readonly mutants: number
  readonly ms: number
  readonly source: CostSource
}

interface LegDraft {
  readonly ms: number
  readonly projects: HashSet.HashSet<string>
  readonly blocks: Arr.NonEmptyArray<Block>
}

interface Segmented {
  readonly closed: ReadonlyArray<LegDraft>
  readonly open: Option.Option<LegDraft>
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

const p90Of = (rates: ReadonlyArray<number>): Option.Option<number> =>
  Arr.match(rates, {
    onEmpty: () => Option.none<number>(),
    onNonEmpty: (owned) => {
      const scaled = 9 * owned.length + 9
      const rank = (scaled - (scaled % 10)) / 10
      return Arr.get(Arr.sort(owned, Order.Number), rank - 1)
    },
  })

const blocksOf = (command: PlanLegsCommand, file: CorpusFile, estimate: Estimate): ReadonlyArray<Block> => {
  const remainder = file.mutants % command.blockMutants
  const blockCount = (file.mutants - remainder) / command.blockMutants + Number(remainder > 0)
  return Arr.range(0, blockCount - 1).map((index) => {
    const mutants = Num.min(command.blockMutants, file.mutants - index * command.blockMutants)
    return {
      project: file.project,
      fileName: file.fileName,
      fileMutants: file.mutants,
      index,
      mutants,
      ms: mutants * estimate.msPerMutant,
      source: estimate.source,
    }
  })
}

const fileOrder: Order.Order<CorpusFile> = Order.combine(
  Order.mapInput(Str.Order, (file: CorpusFile) => file.project),
  Order.mapInput(Str.Order, (file: CorpusFile) => file.fileName),
)

const extraMs = (leg: LegDraft, project: string, overheadOf: (project: string) => number): number =>
  Number(!HashSet.has(leg.projects, project)) * overheadOf(project)

const openedWith = (block: Block, overheadOf: (project: string) => number): LegDraft => ({
  ms: overheadOf(block.project) + block.ms,
  projects: HashSet.make(block.project),
  blocks: [block],
})

const segment = (
  state: Segmented,
  block: Block,
  overheadOf: (project: string) => number,
  capacityMs: number,
): Segmented =>
  Option.match(state.open, {
    onNone: () => ({ closed: state.closed, open: Option.some(openedWith(block, overheadOf)) }),
    onSome: (leg) => {
      const ms = leg.ms + block.ms + extraMs(leg, block.project, overheadOf)
      return Boolean.match(ms <= capacityMs, {
        onTrue: () => ({
          closed: state.closed,
          open: Option.some({
            ms,
            projects: HashSet.add(leg.projects, block.project),
            blocks: Arr.append(leg.blocks, block),
          }),
        }),
        onFalse: () => ({ closed: [...state.closed, leg], open: Option.some(openedWith(block, overheadOf)) }),
      })
    },
  })

const unitOf = (blocks: Arr.NonEmptyReadonlyArray<Block>): PlannedUnit => {
  const first = Arr.headNonEmpty(blocks)
  return PlannedUnit.make({
    project: first.project,
    fileName: first.fileName,
    fromBlock: first.index,
    toBlock: Arr.lastNonEmpty(blocks).index + 1,
    mutants: blocks.reduce((total, block) => total + block.mutants, 0),
    fileMutants: first.fileMutants,
    ms: blocks.reduce((total, block) => total + block.ms, 0),
    source: first.source,
  })
}

const unitsOf = (leg: LegDraft): Arr.NonEmptyArray<PlannedUnit> =>
  Arr.map(
    Arr.groupWith(leg.blocks, (left, right) => keyOf(left) === keyOf(right)),
    unitOf,
  )

const planOf = (command: PlanLegsCommand, files: ReadonlyArray<CorpusFile>): ReadonlyArray<LegDraft> => {
  const samples = HashMap.toValues(command.rates.reduce(mergeSample, HashMap.empty<string, RateSample>()))
  const measuredRates = HashMap.fromIterable(samples.map((sample) => [keyOf(sample), sample.msPerMutant] as const))
  const projectP90s = HashMap.fromIterable(
    Object.entries(Arr.groupBy(samples, (sample) => sample.project)).flatMap(([project, owned]) =>
      Option.toArray(Option.map(p90Of(owned.map((sample) => sample.msPerMutant)), (p90) => [project, p90] as const))
    ),
  )
  const corpusP90 = p90Of(samples.map((sample) => sample.msPerMutant))
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
        Option.match(HashMap.get(projectP90s, file.project), {
          onSome: (msPerMutant) => ({ msPerMutant, source: 'project-p90' as const }),
          onNone: () =>
            Option.match(corpusP90, {
              onSome: (msPerMutant) => ({ msPerMutant, source: 'corpus-p90' as const }),
              onNone: () => ({ msPerMutant: UNMEASURED_MS_PER_MUTANT, source: 'no-measurements' as const }),
            }),
        }),
    })
  const ordered: ReadonlyArray<CorpusFile> = Arr.sort(files, fileOrder)
  const blocks = Arr.flatMap(ordered, (file) => blocksOf(command, file, estimateOf(file)))
  const start: Segmented = { closed: Arr.empty(), open: Option.none() }
  const segmented = Arr.reduce(
    blocks,
    start,
    (state, block) => segment(state, block, overheadOf, command.capacityMs),
  )
  return [...segmented.closed, ...Option.toArray(segmented.open)]
}

const decide = (command: PlanLegsCommand): Result.Result<PlanLegsDecision, never> =>
  Result.succeed(
    Arr.match(planOf(command, dedupedFiles(command.files)), {
      onEmpty: () => NoCorpusMutants.make({}),
      onNonEmpty: (drafts) =>
        LegsPlanned.make({
          legs: Arr.map(drafts, (draft, index) =>
            PlannedLeg.make({ leg: index + 1, ms: draft.ms, units: unitsOf(draft) })),
          totalMs: drafts.reduce((total, draft) =>
            total + draft.ms, 0),
        }),
    }),
  )

export const planLegs = Workflow.make({
  command: PlanLegsCommand,
  decision: PlanLegsDecision,
  error: S.Never,
  decide,
})
