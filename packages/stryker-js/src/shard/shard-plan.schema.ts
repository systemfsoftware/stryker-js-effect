import * as S from 'effect/Schema'

export class ShardPlanInvalid extends S.TaggedError<ShardPlanInvalid>()('ShardPlanInvalid', {
  file: S.String,
  reason: S.String,
}) {
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `invalid shard plan at ${this.file}: ${this.reason}`
  }
}
