import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const INCREMENTAL_PART_NAME = /^stryker-incremental.*\.json$/

type Json = S.Schema.Type<typeof S.Json>

const objectOptionOf = (value: Json | undefined): Option.Option<Record<string, Json>> =>
  Option.liftPredicate(
    value,
    (candidate): candidate is Record<string, Json> => Match.record(candidate),
  )

const decodedReportOf = (text: string): Option.Option<Record<string, Json>> =>
  S.decodeOption(S.fromJsonString(S.Json))(text).pipe(Option.flatMap(objectOptionOf))

const DRY_RUN_COVERAGE = 'dryRunCoverage'

const dryRunCoverageFieldOf = (reports: readonly Record<string, Json>[]): Record<string, Json> =>
  Option.match(Arr.findFirst(reports, (report) => Option.fromUndefinedOr(report[DRY_RUN_COVERAGE])), {
    onNone: (): Record<string, Json> => ({}),
    onSome: (coverage) => ({ [DRY_RUN_COVERAGE]: coverage }),
  })

export const unionIncrementalReports = (texts: readonly string[]): string | undefined => {
  const reports = texts.flatMap((text) => Option.toArray(decodedReportOf(text)))
  return Option.getOrUndefined(
    Option.flatMap(
      Arr.head(reports),
      (first) =>
        S.encodeOption(S.fromJsonString(S.Json, { space: 2 }))({ ...first, ...dryRunCoverageFieldOf(reports) }),
    ),
  )
}
