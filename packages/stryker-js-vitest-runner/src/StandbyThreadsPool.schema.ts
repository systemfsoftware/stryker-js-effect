import * as S from 'effect/Schema'

export class StandbyThreadDied extends S.TaggedError<StandbyThreadDied>()('StandbyThreadDied', {
  cause: S.Unknown,
  message: S.String,
}) {}

export class StandbyThreadStopFailed extends S.TaggedError<StandbyThreadStopFailed>()('StandbyThreadStopFailed', {
  cause: S.Unknown,
  message: S.String,
}) {}

export type StandbyPoolFailed = StandbyThreadDied | StandbyThreadStopFailed
