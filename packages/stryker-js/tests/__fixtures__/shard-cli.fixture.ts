import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const configOf = (breakThreshold: number): string =>
  `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  concurrency: 1,
  reporters: [],
  thresholds: { high: 80, low: 60, break: ${breakThreshold} },
}
`

export const CONFIG = configOf(100)

export const SOURCE = 'export const add = (a, b) => a + b\nexport const sub = (a, b) => a - b\n'

export const decodePlan = (text: string): Option.Option<ShardPlan> => S.decodeOption(S.fromJsonString(ShardPlan))(text)

export const encodePlan = (plan: ShardPlan): Effect.Effect<string> =>
  Effect.orDie(S.encodeEffect(S.fromJsonString(ShardPlan, { space: 2 }))(plan))

const projectLabelsOf = (plan: ShardPlan): ReadonlyArray<string> =>
  Arr.dedupe(plan.shards.flatMap((shard) => shard.projects.map((entry) => entry.project)))

const mutantsOf = (plan: ShardPlan, project: string): ReadonlyArray<string> =>
  plan.shards.flatMap((shard) =>
    shard.projects.filter((entry) => entry.project === project).flatMap((entry) => entry.mutants)
  )

export const singleShardPlanOf = (plan: ShardPlan): ShardPlan => ({
  version: 2,
  scope: plan.scope,
  targetSeconds: 1,
  shards: [{
    index: 1,
    count: 1,
    predictedSeconds: 1,
    projects: projectLabelsOf(plan).map((project) => ({ project, mutants: mutantsOf(plan, project) })),
  }],
  matrix: { include: [{ shard: '1/1', predictedSeconds: 1 }] },
})
