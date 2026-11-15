import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const ShardPlanVersion = S.Literal(2)

export const ShardPlanUnscoped = S.TaggedStruct('Unscoped', {})

export const ShardPlanDiffScoped = S.TaggedStruct('DiffScoped', {
  base: S.NonEmptyString,
  head: S.NonEmptyString,
  sources: S.String,
  files: S.Array(S.String),
})

export const ShardPlanFullScope = S.TaggedStruct('FullScope', {
  base: S.NonEmptyString,
  head: S.NonEmptyString,
  sources: S.String,
  files: S.Array(S.String),
  reason: S.NonEmptyString,
})

export const ShardPlanScope = S.Union([ShardPlanUnscoped, ShardPlanDiffScoped, ShardPlanFullScope])
export type ShardPlanScope = typeof ShardPlanScope.Type

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
  scope: ShardPlanScope,
  targetSeconds: S.Finite,
  shards: S.Array(Shard).check(shardLabelsAreUnique),
  matrix: S.Struct({ include: S.Array(S.Struct({ shard: S.String, predictedSeconds: S.Finite })) }),
})
export type ShardPlan = typeof ShardPlan.Type

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Boolean = await import('effect/Boolean')
  const Result = await import('effect/Result')

  const refusalOf = (plan: typeof ShardPlan.Encoded): string | undefined =>
    Result.match(S.decodeResult(ShardPlan)(plan), {
      onFailure: (error) => error.message,
      onSuccess: () => undefined,
    })

  const DiffScopedFields = S.Struct({
    base: S.String,
    head: S.String,
    sources: S.String,
    files: S.Array(S.String),
  })

  const FullScopeFields = S.Struct({
    base: S.String,
    head: S.String,
    sources: S.String,
    files: S.Array(S.String),
    reason: S.String,
  })

  it.prop(
    '∀x_ShardPlanDiffScoped_≡RefusedWhenBaseOrHeadEmpty',
    { of: [DiffScopedFields], subject: refusalOf },
    (subject, [fields]) =>
      Arr.every(
        [fields, { ...fields, base: '' }, { ...fields, head: '' }],
        (drawn) =>
          (subject({
            version: 2,
            scope: { _tag: 'DiffScoped', ...drawn },
            targetSeconds: 1,
            shards: [],
            matrix: { include: [] },
          }) !== undefined) === !Boolean.and(drawn.base.length > 0, drawn.head.length > 0),
      ),
  )

  it.prop(
    '∀x_ShardPlanFullScope_≡RefusedWhenBaseHeadOrReasonEmpty',
    { of: [FullScopeFields], subject: refusalOf },
    (subject, [fields]) =>
      Arr.every(
        [fields, { ...fields, base: '' }, { ...fields, head: '' }, { ...fields, reason: '' }],
        (drawn) =>
          (subject({
            version: 2,
            scope: { _tag: 'FullScope', ...drawn },
            targetSeconds: 1,
            shards: [],
            matrix: { include: [] },
          }) !== undefined) ===
            !Boolean.and(Boolean.and(drawn.base.length > 0, drawn.head.length > 0), drawn.reason.length > 0),
      ),
  )

  it.prop(
    '∀s_ShardLabelDuplication_≡RefusedNamingTheLabel',
    { of: [Shard], subject: refusalOf },
    (subject, [shard]) => {
      const message = subject({
        version: 2,
        scope: { _tag: 'Unscoped' },
        targetSeconds: 1,
        shards: [shard, shard],
        matrix: { include: [] },
      })
      return message !== undefined && message.includes(labelOf(shard))
    },
  )
}
