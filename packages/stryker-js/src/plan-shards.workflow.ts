import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ShardProject } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const { ceil, max, min, sign } = Math

const CostMs = S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0)))
const PositiveSeconds = S.Finite.pipe(S.check(S.isGreaterThan(0)))
const PositiveInt = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(1)))

export const PlannedMutant = S.Struct({
  project: S.String,
  id: Mutant.MutantId,
  costMs: CostMs,
})
export type PlannedMutant = typeof PlannedMutant.Type

export class PlanShardsCommand extends S.TaggedClass<PlanShardsCommand>()('PlanShardsCommand', {
  targetSeconds: PositiveSeconds,
  maxShards: S.optional(PositiveInt),
  mutants: S.Array(PlannedMutant),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const ShardPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/PlannedShards')
type ShardPlanTypeId = typeof ShardPlanTypeId

export class PlannedShard extends S.TaggedClass<PlannedShard>()('PlannedShard', {
  index: S.Int,
  count: S.Int,
  predictedSeconds: Report.NonNegativeFinite,
  projects: S.Array(ShardProject),
}) {
  readonly [ShardPlanTypeId] = ShardPlanTypeId
}

const compareText = (left: string, right: string): number => sign(Number(left > right) - Number(left < right))

const compareProjectThenId = (left: PlannedMutant, right: PlannedMutant): number =>
  Boolean.match(compareText(left.project, right.project) === 0, {
    onTrue: () => compareText(left.id, right.id),
    onFalse: () => compareText(left.project, right.project),
  })

const compareCostliestFirst = (left: PlannedMutant, right: PlannedMutant): number =>
  Boolean.match(left.costMs === right.costMs, {
    onTrue: () => compareProjectThenId(left, right),
    onFalse: () => sign(right.costMs - left.costMs),
  })

const totalCostMsOf = (mutants: readonly PlannedMutant[]): number =>
  mutants.reduce((total, mutant) => total + mutant.costMs, 0)

const neededShardsOf = (command: PlanShardsCommand): number =>
  max(1, ceil(totalCostMsOf(command.mutants) / 1000 / command.targetSeconds))

const cappedShardsOf = (command: PlanShardsCommand): number =>
  Option.match(Option.fromUndefinedOr(command.maxShards), {
    onNone: () => neededShardsOf(command),
    onSome: (maxShards) => max(1, min(maxShards, neededShardsOf(command))),
  })

const shardCountOf = (command: PlanShardsCommand): number =>
  min(cappedShardsOf(command), max(command.mutants.length, 1))

interface Bin {
  readonly mutants: ReadonlyArray<PlannedMutant>
  readonly load: number
}

const emptyBins = (count: number): ReadonlyArray<Bin> =>
  Array.from({ length: count }, (): Bin => ({ mutants: [], load: 0 }))

const placeIn = (bins: ReadonlyArray<Bin>, mutant: PlannedMutant): ReadonlyArray<Bin> => {
  const loads = bins.map((bin) => bin.load)
  const index = loads.indexOf(min(...loads))
  return bins.map((bin, at) =>
    Boolean.match(at === index, {
      onTrue: (): Bin => ({ mutants: [...bin.mutants, mutant], load: bin.load + mutant.costMs }),
      onFalse: () => bin,
    })
  )
}

const assignLpt = (mutants: readonly PlannedMutant[], count: number): ReadonlyArray<Bin> =>
  [...mutants].sort(compareCostliestFirst).reduce((bins, mutant) => placeIn(bins, mutant), emptyBins(count))

const projectsOf = (mutants: readonly PlannedMutant[]): ReadonlyArray<typeof ShardProject.Type> => {
  const byProject = mutants.reduce<{ readonly [project: string]: ReadonlyArray<string> }>(
    (accumulated, mutant) =>
      Record.set(
        accumulated,
        mutant.project,
        [...Option.getOrElse(Record.get(accumulated, mutant.project), () => []), mutant.id],
      ),
    {},
  )
  return [...Record.toEntries(byProject)]
    .sort(([left], [right]) => compareText(left, right))
    .map(([project, ids]) => ({ project, mutants: [...ids].sort(compareText) }))
}

const shardsOf = (command: PlanShardsCommand): ReadonlyArray<PlannedShard> => {
  const count = shardCountOf(command)
  return assignLpt(command.mutants, count).map((bin, index) =>
    PlannedShard.make({
      index: index + 1,
      count,
      predictedSeconds: bin.load / 1000,
      projects: projectsOf(bin.mutants),
    })
  )
}

export const planShards = Workflow.make({
  command: PlanShardsCommand,
  decision: S.Array(PlannedShard),
  error: S.Never,
  decide: (command: PlanShardsCommand): Result.Result<readonly PlannedShard[], never> =>
    Result.succeed(shardsOf(command)),
})
