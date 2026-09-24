import * as S from 'effect/Schema'

export class GlobalSetupFailure extends S.TaggedError<GlobalSetupFailure>()('GlobalSetupFailure', {
  message: S.String,
  cause: S.optional(S.Defect()),
}) {}
