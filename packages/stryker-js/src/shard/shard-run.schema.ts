import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class ShardChildFailed extends S.TaggedError<ShardChildFailed>()('ShardChildFailed', {
  project: S.String,
  exitCode: S.Int,
  exitClass: Plugin.ExitClass,
  childOutput: S.String,
}) {
  override get message(): string {
    return `shard child for ${this.project} failed with exit code ${this.exitCode}: ${this.childOutput}`
  }
}
