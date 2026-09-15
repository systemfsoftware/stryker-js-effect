import * as S from 'effect/Schema'

export class FrameworkFailed extends S.TaggedError<FrameworkFailed>()('FrameworkFailed', {
  reason: S.String,
  cause: S.Unknown,
}) {}
