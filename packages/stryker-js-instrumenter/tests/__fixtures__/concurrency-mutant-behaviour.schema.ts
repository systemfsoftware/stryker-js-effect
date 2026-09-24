import * as S from 'effect/Schema'

export class FixtureImportError extends S.TaggedError<FixtureImportError>()('FixtureImportError', {
  url: S.String,
}) {}
