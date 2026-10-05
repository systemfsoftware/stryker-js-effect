/* oxlint-disable effecttsgo/schema-number */
import * as S from 'effect/Schema'

export const ShardPlanVersion = S.Literal(1)

export const ShardProject = S.Struct({
  project: S.String, // posix path of the project dir, relative to the plan file's directory
  mutants: S.Array(S.String), // 16-hex content ids, sorted ascending; only mutants this shard must run
})

export const Shard = S.Struct({
  index: S.Int, // 1-based
  count: S.Int,
  predictedSeconds: S.Number,
  projects: S.Array(ShardProject),
})

export const ShardPlan = S.Struct({
  version: ShardPlanVersion,
  targetSeconds: S.Number,
  shards: S.Array(Shard),
  matrix: S.Struct({ include: S.Array(S.Struct({ shard: S.String, predictedSeconds: S.Number })) }), // shard = "k/N"
})
export type ShardPlan = typeof ShardPlan.Type
