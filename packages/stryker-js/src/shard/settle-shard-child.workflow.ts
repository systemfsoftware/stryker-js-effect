import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const SettleShardChildTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/SettleShardChild')
type SettleShardChildTypeId = typeof SettleShardChildTypeId

const COMPLETED_CODE = 0

const verdictFailCode: number | undefined = Option.getOrUndefined(
  S.decodeOption(Plugin.ExitCodeFromClass)('VerdictFail'),
)

export class SettleShardChildCommand extends S.TaggedClass<SettleShardChildCommand>()('SettleShardChildCommand', {
  exitCode: S.Int,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ShardChildCompleted extends S.TaggedClass<ShardChildCompleted>()('ShardChildCompleted', {}) {
  readonly [SettleShardChildTypeId] = SettleShardChildTypeId
}

export class ShardChildVerdictFailed extends S.TaggedClass<ShardChildVerdictFailed>()('ShardChildVerdictFailed', {}) {
  readonly [SettleShardChildTypeId] = SettleShardChildTypeId
}

export class ShardChildAborted extends S.TaggedClass<ShardChildAborted>()('ShardChildAborted', {
  exitCode: S.Int,
}) {
  readonly [SettleShardChildTypeId] = SettleShardChildTypeId
}

export const SettleShardChildDecision = S.Union([
  ShardChildCompleted,
  ShardChildVerdictFailed,
  ShardChildAborted,
])
export type SettleShardChildDecision = typeof SettleShardChildDecision.Type

const decide = (command: SettleShardChildCommand): Result.Result<SettleShardChildDecision, never> =>
  Boolean.match(command.exitCode === COMPLETED_CODE, {
    onTrue: () => Result.succeed(ShardChildCompleted.make({})),
    onFalse: () =>
      Boolean.match(command.exitCode === verdictFailCode, {
        onTrue: () => Result.succeed(ShardChildVerdictFailed.make({})),
        onFalse: () => Result.succeed(ShardChildAborted.make({ exitCode: command.exitCode })),
      }),
  })

export const settleShardChild = Workflow.make({
  command: SettleShardChildCommand,
  decision: SettleShardChildDecision,
  error: S.Never,
  decide,
})
