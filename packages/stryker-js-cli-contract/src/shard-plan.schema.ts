import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const ShardPlanVersion = S.Literal(1)

export const ShardProject = S.Struct({
  project: S.String,
  mutants: S.Array(S.String),
})

export const Shard = S.Struct({
  index: S.Int, // 1-based
  count: S.Int,
  predictedSeconds: S.Finite,
  projects: S.Array(ShardProject),
})
type ShardValue = typeof Shard.Type

const labelOf = (shard: ShardValue): string => `${shard.index}/${shard.count}`

const shardLabelsAreUnique = S.makeFilter(
  (shards: ReadonlyArray<ShardValue>): string | undefined => {
    const duplicated = Mutant.duplicatedValue(shards.map(labelOf))
    return duplicated === undefined ? undefined : `shard plan shards share the label "${duplicated}"`
  },
  { arbitraryConstraint: { uniqueBy: labelOf } },
)

export const ShardPlan = S.Struct({
  version: ShardPlanVersion,
  targetSeconds: S.Finite,
  shards: S.Array(Shard).check(shardLabelsAreUnique),
  matrix: S.Struct({ include: S.Array(S.Struct({ shard: S.String, predictedSeconds: S.Finite })) }),
})
export type ShardPlan = typeof ShardPlan.Type

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Result = await import('effect/Result')

  const refusalOf = (plan: typeof ShardPlan.Encoded): string | undefined =>
    Result.match(S.decodeResult(ShardPlan)(plan), {
      onFailure: (error) => error.message,
      onSuccess: () => undefined,
    })

  it.prop(
    '∀s_ShardLabelDuplication_≡RefusedNamingTheLabel',
    { of: [Shard], subject: refusalOf },
    (subject, [shard]) => {
      const repeated: typeof ShardPlan.Encoded = {
        version: 1,
        targetSeconds: 1,
        shards: [shard, shard],
        matrix: { include: [] },
      }
      const message = subject(repeated)
      return message !== undefined && message.includes(labelOf(shard))
    },
  )
}
