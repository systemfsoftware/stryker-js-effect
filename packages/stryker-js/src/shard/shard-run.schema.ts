import * as S from 'effect/Schema'

export class ShardChildFailed extends S.TaggedError<ShardChildFailed>()('ShardChildFailed', {
  project: S.String,
  exitCode: S.Int,
  childOutput: S.String,
}) {
  readonly exitClass = 'RuntimeError' as const

  override get message(): string {
    return `shard child for ${this.project} failed with exit code ${this.exitCode}: ${this.childOutput}`
  }
}
