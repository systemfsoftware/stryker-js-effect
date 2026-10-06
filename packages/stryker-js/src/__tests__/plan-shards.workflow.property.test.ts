import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'

import { type PlannedShard, planShards, PlanShardsCommand } from '../plan-shards.workflow.js'

type PlanSubject = (command: PlanShardsCommand) => Result.Result<readonly PlannedShard[], never>

const shardsOf = (subject: PlanSubject, command: PlanShardsCommand): ReadonlyArray<PlannedShard> | undefined =>
  Result.match(subject(command), { onFailure: () => undefined, onSuccess: (shards) => shards })

const scheduledPlacements = (shards: ReadonlyArray<PlannedShard>): ReadonlyArray<string> =>
  shards.flatMap((shard) => shard.projects.flatMap((entry) => entry.mutants.map((id) => `${entry.project}|${id}`)))

const multisetOf = (entries: ReadonlyArray<string>): string => JSON.stringify([...entries].sort())

const loadsOf = (command: PlanShardsCommand, shards: ReadonlyArray<PlannedShard>): ReadonlyArray<number> => {
  const costs = new Map(command.mutants.map((mutant) => [`${mutant.project}|${mutant.id}`, mutant.costMs]))
  return shards.map((shard) =>
    shard.projects
      .flatMap((entry) => entry.mutants.map((id) => costs.get(`${entry.project}|${id}`) ?? 0))
      .reduce((total, cost) => total + cost, 0)
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
      const totalSeconds = command.mutants.reduce((total, mutant) => total + mutant.costMs, 0) / 1000
      const needed = Math.max(1, Math.ceil(totalSeconds / command.targetSeconds))
      const capped = command.maxShards === undefined ? needed : Math.max(1, Math.min(command.maxShards, needed))
      const expected = Math.min(capped, Math.max(command.mutants.length, 1))
      return shards.length === expected && shards.every((shard) => shard.count === expected)
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
