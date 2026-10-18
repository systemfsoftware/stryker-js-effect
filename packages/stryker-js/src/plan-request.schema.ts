import type { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class PlanShardsRefused extends S.TaggedError<PlanShardsRefused>()('PlanShardsRefused', {
  detail: S.String,
}) {
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
