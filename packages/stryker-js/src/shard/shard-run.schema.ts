import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

const CONFIG_ERROR_CODE: number | undefined = Option.getOrUndefined(
  S.decodeOption(Plugin.ExitCodeFromClass)('ConfigError'),
)

export class ShardChildFailed extends S.TaggedError<ShardChildFailed>()('ShardChildFailed', {
  project: S.String,
  exitCode: S.Int,
  childOutput: S.String,
}) {
  get exitClass(): Plugin.ExitClass {
    return this.exitCode === CONFIG_ERROR_CODE ? 'ConfigError' : 'RuntimeError'
  }

  override get message(): string {
    return `shard child for ${this.project} failed with exit code ${this.exitCode}: ${this.childOutput}`
  }
}
