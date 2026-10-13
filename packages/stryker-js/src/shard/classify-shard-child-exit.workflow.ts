import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ClassifyShardChildExitTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ClassifyShardChildExit')
type ClassifyShardChildExitTypeId = typeof ClassifyShardChildExitTypeId

const CONFIG_ERROR_CODE: number | undefined = Option.getOrUndefined(
  S.decodeOption(Plugin.ExitCodeFromClass)('ConfigError'),
)

export class ClassifyShardChildExitCommand extends S.TaggedClass<ClassifyShardChildExitCommand>()(
  'ClassifyShardChildExitCommand',
  {
    exitCode: S.Int,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ShardChildConfigErrored extends S.TaggedClass<ShardChildConfigErrored>()('ShardChildConfigErrored', {
  exitClass: S.tag('ConfigError'),
}) {
  readonly [ClassifyShardChildExitTypeId] = ClassifyShardChildExitTypeId
}

export class ShardChildRuntimeErrored extends S.TaggedClass<ShardChildRuntimeErrored>()('ShardChildRuntimeErrored', {
  exitClass: S.tag('RuntimeError'),
}) {
  readonly [ClassifyShardChildExitTypeId] = ClassifyShardChildExitTypeId
}

export const ClassifyShardChildExitDecision = S.Union([ShardChildConfigErrored, ShardChildRuntimeErrored])
export type ClassifyShardChildExitDecision = typeof ClassifyShardChildExitDecision.Type

export const classifyShardChildExit = Workflow.make({
  command: ClassifyShardChildExitCommand,
  decision: ClassifyShardChildExitDecision,
  error: S.Never,
  decide: (command: ClassifyShardChildExitCommand): Result.Result<ClassifyShardChildExitDecision, never> =>
    Boolean.match(command.exitCode === CONFIG_ERROR_CODE, {
      onTrue: () => Result.succeed(ShardChildConfigErrored.make({})),
      onFalse: () => Result.succeed(ShardChildRuntimeErrored.make({})),
    }),
})
