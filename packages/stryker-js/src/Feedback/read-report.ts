import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { surfacedSurvivorsOf } from '../surfacing.js'
import { type SurfacingCaps, SurfacingFields, type SurvivorRef } from '../surfacing.schema.js'
import { FeedbackUnusable } from './Feedback.schema.js'

export const MUTATION_REPORT_FILE = 'reports/mutation/mutation.json'
export const FEEDBACK_FILE = 'reports/mutation/feedback.jsonl'

const SURFACING_DEFAULTS: SurfacingCaps = { perLine: 1, perFile: 7 }

const capsOf = (fields: SurfacingFields): SurfacingCaps => ({
  perLine: Option.getOrElse(Option.fromNullishOr(fields.perLine), () => SURFACING_DEFAULTS.perLine),
  perFile: Option.getOrElse(Option.fromNullishOr(fields.perFile), () => SURFACING_DEFAULTS.perFile),
})

const surfacingCapsOf = (report: Report.MutationTestResult): SurfacingCaps =>
  Option.getOrElse(
    Option.map(S.decodeUnknownOption(SurfacingFields)(report.config?.['surfacing']), capsOf),
    () => SURFACING_DEFAULTS,
  )

export const readMutationReport = (
  basePath: string,
): Effect.Effect<Report.MutationTestResult, FeedbackUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = path.resolve(basePath, MUTATION_REPORT_FILE)
    const text = yield* fs.readFileString(file).pipe(
      Effect.mapError(() =>
        FeedbackUnusable.make({
          reason: `cannot read the finished mutation report at ${file}; run \`stryker run\` first`,
        })
      ),
    )
    return yield* Effect.fromResult(
      Result.mapError(
        S.decodeResult(S.fromJsonString(Report.MutationTestResult))(text),
        (error) =>
          FeedbackUnusable.make({
            reason: `cannot decode the finished mutation report at ${file}: ${error.message}`,
          }),
      ),
    )
  })

export const readSurfacedSurvivors = (
  basePath: string,
): Effect.Effect<ReadonlyArray<SurvivorRef>, FeedbackUnusable, FileSystem.FileSystem | Path.Path> =>
  Effect.map(readMutationReport(basePath), (report) => surfacedSurvivorsOf(report, surfacingCapsOf(report)))
