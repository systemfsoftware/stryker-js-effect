import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'

import { type PlannedMutant, type PlannedShard, planShards, PlanShardsCommand } from '../plan-shards.workflow.js'

type PlanSubject = (command: PlanShardsCommand) => Result.Result<readonly PlannedShard[], never>

const shardsOf = (subject: PlanSubject, command: PlanShardsCommand): ReadonlyArray<PlannedShard> | undefined =>
  Result.match(subject(command), { onFailure: () => undefined, onSuccess: (shards) => shards })

const scheduledPlacements = (shards: ReadonlyArray<PlannedShard>): ReadonlyArray<string> =>
  shards.flatMap((shard) => shard.projects.flatMap((entry) => entry.mutants.map((id) => `${entry.project}|${id}`)))

const multisetOf = (entries: ReadonlyArray<string>): string => JSON.stringify([...entries].sort())

const compareText = (left: string, right: string): number => Math.sign(Number(left > right) - Number(left < right))

const compareProjectThenId = (left: PlannedMutant, right: PlannedMutant): number =>
  compareText(left.project, right.project) === 0
    ? compareText(left.id, right.id)
    : compareText(left.project, right.project)

const compareCostliestFirst = (left: PlannedMutant, right: PlannedMutant): number =>
  left.costMs === right.costMs ? compareProjectThenId(left, right) : Math.sign(right.costMs - left.costMs)

const dryRunCostOf = (command: PlanShardsCommand, project: string): number => command.dryRunCosts[project] ?? 0

const dependentCostByProjectOf = (command: PlanShardsCommand): ReadonlyArray<readonly [string, number]> => {
  const totals = command.mutants.reduce<Record<string, number>>(
    (accumulated, mutant) =>
      mutant.dependsOnDryRun
        ? { ...accumulated, [mutant.project]: (accumulated[mutant.project] ?? 0) + mutant.costMs }
        : accumulated,
    {},
  )
  return Object.entries(totals)
}

const dryRunBinsNeededOf = (command: PlanShardsCommand, project: string, dependentCostMs: number): number => {
  const remainingMs = command.targetSeconds * 1000 - dryRunCostOf(command, project)
  return remainingMs > 0 ? Math.max(1, Math.ceil(dependentCostMs / remainingMs)) : Number.POSITIVE_INFINITY
}

const expectedShardCountOf = (command: PlanShardsCommand): number => {
  const mutantCostMs = command.mutants.reduce((total, mutant) => total + mutant.costMs, 0)
  const dryRunLoadMs = dependentCostByProjectOf(command).reduce((total, [project, dependentCostMs]) => {
    const bins = dryRunBinsNeededOf(command, project, dependentCostMs)
    return Number.isFinite(bins) ? total + bins * dryRunCostOf(command, project) : total
  }, 0)
  const needed = Math.max(1, Math.ceil((mutantCostMs + dryRunLoadMs) / 1000 / command.targetSeconds))
  const capped = command.maxShards === undefined ? needed : Math.max(1, Math.min(command.maxShards, needed))
  return Math.min(capped, Math.max(command.mutants.length, 1))
}

const loadsOf = (command: PlanShardsCommand, shards: ReadonlyArray<PlannedShard>): ReadonlyArray<number> => {
  const costs = new Map(command.mutants.map((mutant) => [`${mutant.project}|${mutant.id}`, mutant.costMs]))
  return shards.map((shard) =>
    shard.projects
      .flatMap((entry) => entry.mutants.map((id) => costs.get(`${entry.project}|${id}`) ?? 0))
      .reduce((total, cost) => total + cost, 0)
  )
}

const loadOfBinAt = (bins: ReadonlyArray<{ readonly load: number }>, index: number): number => bins[index]?.load ?? 0

const referenceLptBinsOf = (
  mutants: readonly PlannedMutant[],
  count: number,
): ReadonlyArray<{ readonly placements: ReadonlyArray<string>; readonly load: number }> => {
  const bins = Array.from(
    { length: count },
    (): { placements: string[]; load: number } => ({ placements: [], load: 0 }),
  )
  for (const mutant of [...mutants].sort(compareCostliestFirst)) {
    let index = 0
    for (let at = 1; at < bins.length; at += 1) {
      if (loadOfBinAt(bins, at) < loadOfBinAt(bins, index)) {
        index = at
      }
    }
    const target = bins[index]
    if (target !== undefined) {
      bins[index] = {
        placements: [...target.placements, `${mutant.project}|${mutant.id}`],
        load: target.load + mutant.costMs,
      }
    }
  }
  return bins
}

const placementKeysOf = (placementsPerShard: ReadonlyArray<ReadonlyArray<string>>): ReadonlyArray<string> =>
  placementsPerShard.map((placements) => [...placements].sort().join(','))

const occupiedShardsOfProject = (
  command: PlanShardsCommand,
  project: string,
  shards: ReadonlyArray<PlannedShard>,
): number => {
  const dependentIds = new Set<string>(
    command.mutants
      .filter((mutant) => mutant.dependsOnDryRun && mutant.project === project)
      .map((mutant) => mutant.id),
  )
  return shards.filter((shard) =>
    shard.projects.some((entry) => entry.project === project && entry.mutants.some((id) => dependentIds.has(id)))
  ).length
}

const dependentMutantsRespectDryRunBudget = (
  command: PlanShardsCommand,
  shards: ReadonlyArray<PlannedShard>,
): boolean => {
  const count = expectedShardCountOf(command)
  return dependentCostByProjectOf(command).every(([project, dependentCostMs]) => {
    const budget = Math.min(dryRunBinsNeededOf(command, project, dependentCostMs), count)
    return occupiedShardsOfProject(command, project, shards) <= budget
  })
}

const reproducesPureLptShards = (command: PlanShardsCommand, shards: ReadonlyArray<PlannedShard>): boolean => {
  const count = expectedShardCountOf(command)
  const reference = referenceLptBinsOf(command.mutants, count)
  return (
    shards.length === count &&
    Equal.equals(
      placementKeysOf(shards.map((shard) => scheduledPlacements([shard]))),
      placementKeysOf(reference.map((bin) => bin.placements)),
    ) &&
    shards.every((shard, index) => shard.predictedSeconds === loadOfBinAt(reference, index) / 1000)
  )
}

describe('planShards', () => {
  it.prop(
    '∀c_Mutants_≡EveryScheduledMutantLandsInExactlyOneShard',
    { of: [PlanShardsCommand], subject: planShards },
    (subject, [command]) => {
      const shards = shardsOf(subject, command)
      return shards !== undefined &&
        multisetOf(scheduledPlacements(shards)) ===
          multisetOf(command.mutants.map((mutant) => `${mutant.project}|${mutant.id}`)) &&
        shards.every((shard) => shard.projects.every((entry) => entry.mutants.length > 0))
    },
  )

  it.prop(
    '∀c_Mutants_≡ReorderingTheInputKeepsTheSameShards',
    { of: [PlanShardsCommand], subject: planShards },
    (subject, [command]) => {
      const reversed = PlanShardsCommand.make({
        targetSeconds: command.targetSeconds,
        maxShards: command.maxShards,
        mutants: [...command.mutants].reverse(),
        dryRunCosts: command.dryRunCosts,
      })
      const shards = shardsOf(subject, command)
      const reordered = shardsOf(subject, reversed)
      return shards !== undefined && reordered !== undefined && Equal.equals(shards, reordered)
    },
  )

  it.prop(
    '∀c_Mutants_≡TheShardCountIsMinOfTheCapAndTheTargetQuotient',
    { of: [PlanShardsCommand], subject: planShards },
    (subject, [command]) => {
      const shards = shardsOf(subject, command)
      if (shards === undefined) {
        return false
      }
      const expected = expectedShardCountOf(command)
      return shards.length === expected && shards.every((shard) => shard.count === expected)
    },
  )

  it.prop(
    '∀c_Mutants_≡DependentMutantsStayWithinTheirDryRunShardBudget',
    { of: [PlanShardsCommand], subject: planShards },
    (subject, [command]) => {
      const shards = shardsOf(subject, command)
      return shards !== undefined && dependentMutantsRespectDryRunBudget(command, shards)
    },
  )

  it.prop(
    '∀c_Mutants_≡NoDependentMutantReproducesPureLptShards',
    { of: [PlanShardsCommand], subject: planShards },
    (subject, [command]) => {
      const flat = PlanShardsCommand.make({
        targetSeconds: command.targetSeconds,
        maxShards: command.maxShards,
        mutants: command.mutants.map((mutant) => ({ ...mutant, dependsOnDryRun: false })),
        dryRunCosts: {},
      })
      const shards = shardsOf(subject, flat)
      return shards !== undefined && reproducesPureLptShards(flat, shards)
    },
  )

  it.prop(
    '∀c_Mutants_≡LptKeepsTheBusiestShardWithinFourThirdsOfAveragePlusLargestItem',
    { of: [PlanShardsCommand], subject: planShards },
    (subject, [command]) => {
      const shards = shardsOf(subject, command)
      if (shards === undefined) {
        return false
      }
      const loads = loadsOf(command, shards)
      const count = shards.length
      const total = loads.reduce((sum, load) => sum + load, 0)
      const largest = command.mutants.reduce((max, mutant) => Math.max(max, mutant.costMs), 0)
      const busiest = loads.reduce((max, load) => Math.max(max, load), 0)
      return busiest <= (4 / 3) * (total / count + largest) + 1e-9
    },
  )
})
