import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

const RecordedDryRun = S.Struct({
  dryRunCoverage: S.Struct({
    tests: S.Array(S.Struct({ timeSpentMs: S.Finite })),
    timeOverheadMs: S.Finite,
  }),
})

export const recordedDryRunMsOf = (text: string): number =>
  Option.match(S.decodeOption(S.fromJsonString(RecordedDryRun))(text), {
    onNone: () => 0,
    onSome: ({ dryRunCoverage }) =>
      dryRunCoverage.tests.reduce((total, test) => total + test.timeSpentMs, 0) + dryRunCoverage.timeOverheadMs,
  })
