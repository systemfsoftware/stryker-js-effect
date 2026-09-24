import * as S from 'effect/Schema'

export class EnvironmentSetupFailure extends S.TaggedError<EnvironmentSetupFailure>()('EnvironmentSetupFailure', {
  message: S.String,
  cause: S.optional(S.Defect()),
}) {}
