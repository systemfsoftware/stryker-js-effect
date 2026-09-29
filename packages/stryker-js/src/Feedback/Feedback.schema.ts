import * as S from 'effect/Schema'

export class FeedbackUnusable extends S.TaggedError<FeedbackUnusable>()('FeedbackUnusable', {
  reason: S.String,
}) {
  override get message(): string {
    return `Cannot record feedback: ${this.reason}`
  }
}
