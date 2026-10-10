import { BenchAbortCode, BenchReportOutcome, SetupStep } from '@systemfsoftware/stryker-e2e-core'
import * as S from 'effect/Schema'

export class BenchOrchestrationFailed extends S.TaggedError<BenchOrchestrationFailed>()('BenchOrchestrationFailed', {
  code: BenchAbortCode,
  reason: S.String,
}) {
  override get message(): string {
    return `${this.code}: ${this.reason}`
  }
}

export class BenchStoppedAtSetup extends S.TaggedError<BenchStoppedAtSetup>()('BenchStoppedAtSetup', {
  outcome: BenchReportOutcome,
  setupSteps: S.Array(SetupStep),
}) {
  override get message(): string {
    return `setup stopped the bench: ${this.outcome._tag}`
  }
}
