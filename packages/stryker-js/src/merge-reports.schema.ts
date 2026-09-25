import * as S from 'effect/Schema'

export class MergeReportsFailed extends S.TaggedError<MergeReportsFailed>()('MergeReportsFailed', {
  reason: S.String,
}) {}

export const PartMetaSchema = S.Struct({ package: S.String, outcome: S.String })
