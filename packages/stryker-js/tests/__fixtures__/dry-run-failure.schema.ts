import * as S from 'effect/Schema'

export const BaselineTestsFailedEvidence = S.TaggedStruct('BaselineTestsFailed', {
  stage: S.Literal('dryRun'),
  testCount: S.Finite,
  tests: S.Array(S.Struct({
    id: S.String,
    name: S.String,
    file: S.NullOr(S.String),
    location: S.NullOr(S.Struct({ file: S.String, line: S.Finite, column: S.Finite })),
    message: S.String,
    stack: S.NullOr(S.String),
  })),
})
