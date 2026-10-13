import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as S from 'effect/Schema'

export class ShardMergeFailed extends S.TaggedError<ShardMergeFailed>()('ShardMergeFailed', {
  reason: S.String,
}) {
  override get message(): string {
    return this.reason
  }
}

export const MergedProjectThresholds = S.Union([
  S.TaggedStruct('Recorded', RunEvent.VerdictThresholds.fields),
  S.TaggedStruct('Unrecorded', {}),
])
export type MergedProjectThresholds = typeof MergedProjectThresholds.Type

export const MergedProject = S.Struct({
  project: S.String,
  thresholds: MergedProjectThresholds,
  files: S.Array(S.String),
})
export type MergedProject = typeof MergedProject.Type
