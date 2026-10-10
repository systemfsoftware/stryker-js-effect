import * as S from 'effect/Schema'

export const BakeReasonCode = S.Literals([
  'E2E_BAKE_ARGV',
  'E2E_BAKE_STALLED',
  'E2E_BAKE_CUTOFF_STALE',
  'E2E_BAKE_OVER_BUDGET',
  'E2E_BAKE_FAILED',
  'E2E_SETUP_FAILED',
])
export type BakeReasonCode = typeof BakeReasonCode.Type

export const BakeReason = S.Struct({ code: BakeReasonCode, detail: S.String, next: S.String })
export type BakeReason = typeof BakeReason.Type

export class BakeDone extends S.TaggedClass<BakeDone>()('BakeDone', {
  packsKey: S.String,
  fixtures: S.Int,
  baked: S.Int,
  seconds: S.Finite,
  locks: S.Record(S.String, S.String),
}) {}

export class BakeFailed extends S.TaggedClass<BakeFailed>()('BakeFailed', {
  reasons: S.NonEmptyArray(BakeReason),
  seconds: S.Finite,
}) {}

export const BakeRecord = S.Union([BakeDone, BakeFailed])
export type BakeRecord = typeof BakeRecord.Type

export const BakeReport = S.Struct({
  packsKey: S.String,
  baked: S.Int,
  summary: S.String,
  annotations: S.Array(S.String),
})
export type BakeReport = typeof BakeReport.Type

export const BakeReportJson = S.fromJsonString(BakeReport)
