import * as S from 'effect/Schema'

export class BenchOrchestrationFailed extends S.TaggedError<BenchOrchestrationFailed>()('BenchOrchestrationFailed', {
  reason: S.String,
}) {
  override get message(): string {
    return this.reason
  }
}
