import { Reports } from '@systemfsoftware/stryker-js-contracts'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { Reporting } from '@systemfsoftware/stryker-js-reporting'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const MUTATION_REPORT_FILE = 'reports/mutation/mutation.json'
export const FEEDBACK_FILE = 'reports/mutation/feedback.jsonl'

const SURFACING_DEFAULTS: Reports.SurfacingCaps = { perLine: 1, perFile: 7 }

const capsOf = (fields: Reports.SurfacingFields): Reports.SurfacingCaps => ({
  perLine: Option.getOrElse(Option.fromNullishOr(fields.perLine), () => SURFACING_DEFAULTS.perLine),
  perFile: Option.getOrElse(Option.fromNullishOr(fields.perFile), () => SURFACING_DEFAULTS.perFile),
})

const surfacingCapsOf = (report: Report.MutationTestResult): Reports.SurfacingCaps =>
  Option.getOrElse(
    Option.map(S.decodeUnknownOption(Reports.SurfacingFields)(report.config?.['surfacing']), capsOf),
    () => SURFACING_DEFAULTS,
  )

export const readMutationReport = (
  basePath: string,
): Effect.Effect<Report.MutationTestResult, Reports.FeedbackUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = path.resolve(basePath, MUTATION_REPORT_FILE)
    const text = yield* fs.readFileString(file).pipe(
      Effect.mapError(() =>
        Reports.FeedbackUnusable.make({
          reason: `cannot read the finished mutation report at ${file}; run \`stryker run\` first`,
        })
      ),
    )
    return yield* Effect.fromResult(
      Result.mapError(
        S.decodeResult(S.fromJsonString(Report.MutationTestResult))(text),
        (error) =>
          Reports.FeedbackUnusable.make({
            reason: `cannot decode the finished mutation report at ${file}: ${error.message}`,
          }),
      ),
    )
  })

export const readSurfacedSurvivors = (
  basePath: string,
): Effect.Effect<ReadonlyArray<Reports.SurvivorRef>, Reports.FeedbackUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.map(readMutationReport(basePath), (report) => Reporting.surfacedSurvivorsOf(report, surfacingCapsOf(report)))
