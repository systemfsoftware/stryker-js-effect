import type { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const CostsFieldSchema = S.StructWithRest(
  S.Struct({
    costs: S.Record(S.String, S.Struct({ predictedMs: S.Finite, actualMs: S.NullOr(S.Finite) })).pipe(S.optional),
  }),
  [S.Record(S.String, S.Json)],
)

export type CostsField = typeof CostsFieldSchema.Type

export const CompileErrorProbeSchema = S.Struct({
  files: S.Record(S.String, S.Struct({ mutants: S.Array(S.Struct({ status: S.String })) })),
})

export class PlanShardsRefused
  extends S.TaggedError<PlanShardsRefused, { readonly brand: unique symbol }>()('PlanShardsRefused', {
    detail: S.String,
  })
{
  readonly exitClass = 'ConfigError' satisfies Plugin.ExitClass
  readonly next =
    'Pass --target-seconds above 0 and --max-shards of 1 or more, and name each project directory once in --projects.'

  get reason(): string {
    return `stryker plan: the planner refused its input: ${this.detail}. ${this.next}`
  }

  override get message(): string {
    return this.reason
  }
}
