import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ShardProject } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const { ceil, max, min, sign } = Math

const MAX_COST_MS = Number.MAX_SAFE_INTEGER
const CostMs = S.Finite.pipe(S.check(S.isBetween({ minimum: 0, maximum: MAX_COST_MS })))
const PositiveSeconds = S.Finite.pipe(S.check(S.isGreaterThan(0)))
const PositiveInt = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(1)))

export const PlannedMutant = S.Struct({
  project: S.String,
  id: Mutant.MutantId,
  costMs: CostMs,
  dependsOnDryRun: S.Boolean,
  placementKey: S.optional(Mutant.MutantId),
})
export type PlannedMutant = typeof PlannedMutant.Type

export class PlanShardsCommand extends S.TaggedClass<PlanShardsCommand>()('PlanShardsCommand', {
  targetSeconds: PositiveSeconds,
  maxShards: S.optional(PositiveInt),
  mutants: S.Array(PlannedMutant),
  dryRunCosts: S.Record(S.String, CostMs),
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

const totalCostMsOf = (mutants: readonly PlannedMutant[]): number =>
  mutants.reduce((total, mutant) => total + mutant.costMs, 0)

const dryRunCostOf = (command: PlanShardsCommand, project: string): number =>
  Option.getOrElse(Record.get(command.dryRunCosts, project), () => 0)

interface DependentProject {
  readonly project: string
  readonly dependentCostMs: number
  readonly dryRunCostMs: number
  readonly mutants: ReadonlyArray<PlannedMutant>
}

const dependentProjectsOf = (command: PlanShardsCommand): ReadonlyArray<DependentProject> => {
  const byProject = command.mutants.reduce<Record<string, ReadonlyArray<PlannedMutant>>>(
    (accumulated, mutant) =>
      Boolean.match(mutant.dependsOnDryRun, {
        onTrue: () =>
          Record.set(
            accumulated,
            mutant.project,
            [
              ...Option.getOrElse(Record.get(accumulated, mutant.project), (): ReadonlyArray<PlannedMutant> => []),
              mutant,
            ],
          ),
        onFalse: () => accumulated,
      }),
    {},
  )
  return [...Record.toEntries(byProject)]
    .sort(([left], [right]) => compareText(left, right))
    .map(([project, mutants]) => ({
      project,
      dependentCostMs: totalCostMsOf(mutants),
      dryRunCostMs: dryRunCostOf(command, project),
      mutants,
    }))
}

const dryRunBinsNeededOf = (project: DependentProject, targetMs: number): number => {
  const remainingMs = targetMs - project.dryRunCostMs
  return Boolean.match(remainingMs > 0, {
    onTrue: () => max(1, ceil(project.dependentCostMs / remainingMs)),
    onFalse: () => Number.POSITIVE_INFINITY,
  })
}

const plannedLoadMsOf = (
  command: PlanShardsCommand,
  projects: ReadonlyArray<DependentProject>,
  targetMs: number,
): number =>
  totalCostMsOf(command.mutants) +
  projects.reduce((total, project) => {
    const bins = dryRunBinsNeededOf(project, targetMs)
    return Boolean.match(Number.isFinite(bins), {
      onTrue: () => total + bins * project.dryRunCostMs,
      onFalse: () => total,
    })
  }, 0)

const neededShardsOf = (command: PlanShardsCommand, loadMs: number): number =>
  max(1, ceil(loadMs / 1000 / command.targetSeconds))

const cappedShardsOf = (command: PlanShardsCommand, loadMs: number): number =>
  Option.match(Option.fromUndefinedOr(command.maxShards), {
    onNone: () => neededShardsOf(command, loadMs),
    onSome: (maxShards) => max(1, min(maxShards, neededShardsOf(command, loadMs))),
  })

const shardCountOf = (command: PlanShardsCommand, loadMs: number): number =>
  min(cappedShardsOf(command, loadMs), max(command.mutants.length, 1))

interface Bin {
  readonly mutants: ReadonlyArray<PlannedMutant>
  readonly load: number
}

const EMPTY_BIN: Bin = { mutants: [], load: 0 }

const emptyBins = (count: number): ReadonlyArray<Bin> =>
  Array.from({ length: count }, (): Bin => ({ mutants: [], load: 0 }))

const indicesOf = (count: number): ReadonlyArray<number> => Array.from({ length: count }, (_unused, index) => index)

const loadAt = (bins: ReadonlyArray<Bin>, index: number): number =>
  Option.getOrElse(Option.fromUndefinedOr(bins[index]), () => EMPTY_BIN).load

const leastLoadedOf = (bins: ReadonlyArray<Bin>, indices: ReadonlyArray<number>): number =>
  indices.reduce(
    (best, index) =>
      Boolean.match(loadAt(bins, index) < loadAt(bins, best), { onTrue: () => index, onFalse: () => best }),
    Option.getOrElse(Option.fromUndefinedOr(indices[0]), () => 0),
  )

interface LoadedBin {
  readonly index: number
  readonly load: number
}

const compareLoadedBins = (left: LoadedBin, right: LoadedBin): number =>
  sign(sign(left.load - right.load) * 2 + sign(left.index - right.index))

const leastLoadedIndicesOf = (bins: ReadonlyArray<Bin>, count: number): ReadonlyArray<number> =>
  indicesOf(bins.length)
    .map((index): LoadedBin => ({ index, load: loadAt(bins, index) }))
    .sort(compareLoadedBins)
    .slice(0, count)
    .map((entry) => entry.index)

interface PlacementGroup {
  readonly key: string
  readonly project: string
  readonly mutants: ReadonlyArray<PlannedMutant>
  readonly costMs: number
  readonly dependsOnDryRun: boolean
}

const placementKeyOf = (mutant: PlannedMutant): string =>
  Option.getOrElse(Option.fromUndefinedOr(mutant.placementKey), () => `\u0000${mutant.project}\u0000${mutant.id}`)

const projectOfGroup = (members: ReadonlyArray<PlannedMutant>): string => {
  const [head] = members
  return head === undefined ? '' : head.project
}

const placementGroupsOf = (mutants: ReadonlyArray<PlannedMutant>): ReadonlyArray<PlacementGroup> => {
  const byKey = new Map<string, ReadonlyArray<PlannedMutant>>()
  for (const mutant of mutants) {
    const key = placementKeyOf(mutant)
    const members = Option.getOrElse(
      Option.fromUndefinedOr(byKey.get(key)),
      (): ReadonlyArray<PlannedMutant> => [],
    )
    byKey.set(key, [...members, mutant])
  }
  return [...byKey.entries()].map(([key, members]) => {
    const sorted = [...members].sort(compareProjectThenId)
    return {
      key,
      project: projectOfGroup(sorted),
      mutants: sorted,
      costMs: totalCostMsOf(sorted),
      dependsOnDryRun: sorted.some((mutant) => mutant.dependsOnDryRun),
    }
  })
}

const compareGroupsCostliestFirst = (left: PlacementGroup, right: PlacementGroup): number =>
  Boolean.match(left.costMs === right.costMs, {
    onTrue: () => compareText(left.key, right.key),
    onFalse: () => sign(right.costMs - left.costMs),
  })

const withGroupIn = (bins: ReadonlyArray<Bin>, index: number, group: PlacementGroup): ReadonlyArray<Bin> =>
  bins.map((bin, at) =>
    Boolean.match(at === index, {
      onTrue: (): Bin => ({ mutants: [...bin.mutants, ...group.mutants], load: bin.load + group.costMs }),
      onFalse: () => bin,
    })
  )

const reservedBin = (bins: ReadonlyArray<Bin>, index: number, costMs: number): ReadonlyArray<Bin> =>
  bins.map((bin, at) =>
    Boolean.match(at === index, {
      onTrue: (): Bin => ({ mutants: bin.mutants, load: bin.load + costMs }),
      onFalse: () => bin,
    })
  )

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
  const targetMs = command.targetSeconds * 1000
  const dependentProjects = dependentProjectsOf(command)
  const count = shardCountOf(command, plannedLoadMsOf(command, dependentProjects, targetMs))
  const reserved = dependentProjects.reduce<{
    readonly bins: ReadonlyArray<Bin>
    readonly indicesByProject: Readonly<Record<string, ReadonlyArray<number>>>
  }>(
    (accumulated, project) => {
      const indices = leastLoadedIndicesOf(accumulated.bins, min(dryRunBinsNeededOf(project, targetMs), count))
      return {
        bins: indices.reduce((bins, index) => reservedBin(bins, index, project.dryRunCostMs), accumulated.bins),
        indicesByProject: { ...accumulated.indicesByProject, [project.project]: indices },
      }
    },
    { bins: emptyBins(count), indicesByProject: {} },
  )
  const groups = placementGroupsOf(command.mutants)
  const dependentGroups = groups.filter((group) => group.dependsOnDryRun).sort(compareGroupsCostliestFirst)
  const withDependents = dependentGroups.reduce(
    (bins, group) =>
      withGroupIn(
        bins,
        leastLoadedOf(
          bins,
          Option.getOrElse(
            Record.get(reserved.indicesByProject, group.project),
            () => indicesOf(count),
          ),
        ),
        group,
      ),
    reserved.bins,
  )
  const restGroups = groups
    .filter((group) => Boolean.not(group.dependsOnDryRun))
    .sort(compareGroupsCostliestFirst)
  const withRest = restGroups.reduce(
    (bins, group) => withGroupIn(bins, leastLoadedOf(bins, indicesOf(bins.length)), group),
    withDependents,
  )
  return withRest.map((bin, index) =>
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

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const isRepresentableCostMs = (costMs: number): boolean =>
    costMs === Math.min(Math.max(costMs, 0), Number.MAX_SAFE_INTEGER)

  const unrepresentableCosts: ReadonlyArray<number> = [
    3.4927206787701224e293,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MAX_VALUE,
    Number.POSITIVE_INFINITY,
    Number.NaN,
  ]

  it.prop(
    '∀c_CostMsRefusal_≡RepresentableCostMs',
    { of: [S.Finite], subject: (costMs: number) => S.is(CostMs)(costMs) },
    (subject, [drawn]) =>
      Arr.every(Arr.append(unrepresentableCosts, drawn), (costMs) => subject(costMs) === isRepresentableCostMs(costMs)),
  )
}
