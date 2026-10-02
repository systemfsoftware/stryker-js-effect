import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import * as S from 'effect/Schema'

export class RunFailure extends S.TaggedError<RunFailure>()('RunFailure', {
  evidence: FailureRecord.FailureEvidence,
  detail: S.String,
  cause: S.optional(S.Defect()),
}) {
  override get message(): string {
    return this.detail
  }
}
