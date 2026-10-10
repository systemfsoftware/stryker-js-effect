import { BenchAbortCode } from '@systemfsoftware/stryker-e2e-core'
import * as S from 'effect/Schema'

export class BenchOrchestrationFailed extends S.TaggedError<BenchOrchestrationFailed>()('BenchOrchestrationFailed', {
  code: BenchAbortCode,
  reason: S.String,
}) {
  override get message(): string {
    return `${this.code}: ${this.reason}`
  }
}
