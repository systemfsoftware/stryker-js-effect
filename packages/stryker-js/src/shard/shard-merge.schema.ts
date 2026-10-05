import * as S from 'effect/Schema'

export class ShardMergeFailed extends S.TaggedError<ShardMergeFailed>()('ShardMergeFailed', {
  reason: S.String,
}) {
  override get message(): string {
    return this.reason
  }
}
