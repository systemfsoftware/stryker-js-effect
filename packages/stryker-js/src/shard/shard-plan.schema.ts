import * as S from 'effect/Schema'

export const ShardPlanInvalidCode = S.Literals(['plan-unreadable', 'plan-undecodable'])
export type ShardPlanInvalidCode = typeof ShardPlanInvalidCode.Type

export class ShardPlanInvalid extends S.TaggedError<ShardPlanInvalid>()('ShardPlanInvalid', {
  file: S.String,
  detail: S.String,
  code: ShardPlanInvalidCode,
  next: S.String,
}) {
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `invalid shard plan at ${this.file} [${this.code}]: ${this.detail}; next: ${this.next}`
  }
}
