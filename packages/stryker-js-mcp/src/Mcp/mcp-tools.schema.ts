import { Reports } from '@systemfsoftware/stryker-js-contracts'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const MutantDetail = S.Struct({
  id: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
  coveringTests: S.Array(S.String),
  killedBy: S.NullOr(S.String),
  reproducer: S.String,
  diff: S.NullOr(S.String),
})

export type MutantDetail = typeof MutantDetail.Type

export class MutantUnusable extends S.TaggedError<MutantUnusable>()('MutantUnusable', {
  id: Mutant.MutantId,
}) {
  override get message(): string {
    return `No mutant ${this.id} in the finished mutation report; run \`stryker run\` first, or read a known id from list_survivors.`
  }
}

export class RerunUnusable extends S.TaggedError<RerunUnusable>()('RerunUnusable', {
  id: Mutant.MutantId,
  reason: S.String,
}) {
  override get message(): string {
    return this.reason
  }
}

export const ShowMutantFailure = S.Union([MutantUnusable, Reports.FeedbackUnusable])

export const RerunMutantFailure = S.Union([MutantUnusable, RerunUnusable])
