import * as S from 'effect/Schema'

export class FrameworkFailed extends S.TaggedError<FrameworkFailed>()('FrameworkFailed', {
  reason: S.String,
  cause: S.Unknown,
  peer: S.optional(S.String),
  version: S.optional(S.String),
  supportedRange: S.optional(S.String),
}) {}
