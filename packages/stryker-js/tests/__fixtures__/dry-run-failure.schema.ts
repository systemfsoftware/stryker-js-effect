import * as S from 'effect/Schema'

export const DryRunFailedCause = S.TaggedStruct('DryRunFailed', {
  testCount: S.Finite,
  failedTestCount: S.Finite,
  failedTests: S.Array(S.Struct({ name: S.String, failureMessage: S.String })),
})

export type DryRunFailedView = S.Schema.Type<typeof DryRunFailedCause>
