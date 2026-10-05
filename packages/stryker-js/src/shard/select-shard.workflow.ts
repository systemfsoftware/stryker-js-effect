import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ShardPlan, ShardProject } from '@systemfsoftware/stryker-js-cli-contract'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const SelectShardTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/SelectShard')
type SelectShardTypeId = typeof SelectShardTypeId

export class SelectShardCommand extends S.Class<SelectShardCommand>('SelectShardCommand')({
  plan: ShardPlan,
  shard: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class SelectedShard extends S.TaggedClass<SelectedShard>()('SelectedShard', {
  index: S.Int,
  count: S.Int,
  projects: S.Array(ShardProject),
}) {
  readonly [SelectShardTypeId] = SelectShardTypeId
}

export class ShardUnknown extends S.TaggedError<ShardUnknown>()('ShardUnknown', {
  shard: S.String,
  reason: S.String,
}) {
  readonly [SelectShardTypeId] = SelectShardTypeId
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return this.reason
  }
}

const labelOf = (shard: { readonly index: number; readonly count: number }): string => `${shard.index}/${shard.count}`

export const selectShard = Workflow.make({
  command: SelectShardCommand,
  decision: SelectedShard,
  error: ShardUnknown,
  decide: (command: SelectShardCommand): Result.Result<SelectedShard, ShardUnknown> =>
    Option.match(
      Option.fromUndefinedOr(command.plan.shards.find((candidate) => labelOf(candidate) === command.shard)),
      {
        onNone: () =>
          Result.fail(
            ShardUnknown.make({
              shard: command.shard,
              reason: `unknown shard ${command.shard}; plan has ${command.plan.shards.map(labelOf).join(', ')}`,
            }),
          ),
        onSome: (shard) =>
          Result.succeed(SelectedShard.make({ index: shard.index, count: shard.count, projects: shard.projects })),
      },
    ),
})
