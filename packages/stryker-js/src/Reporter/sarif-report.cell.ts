import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options, Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Filter from 'effect/Filter'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { sarifFileNameOf } from '../stryker-outputs.js'
import { StrykerPackage } from '../stryker-package.schema.js'
import { surfacedSurvivorsOf } from '../surfacing.js'
import { failAsReporter } from './reporter-failed.js'
import { type SarifLog, sarifReport, type SarifReportCommand, SarifReporterName } from './sarif-report.workflow.js'

const SARIF_MAX_RESULTS = 5000
const STRYKER_INFORMATION_URI = 'https://stryker-mutator.io'

const failAsSarif = failAsReporter(SarifReporterName.literal)

const reportOf = Filter.make((
  event: Reporter.ReporterEvent,
): Result.Result<Report.MutationTestResult, 'not-ready'> =>
  Match.value(event).pipe(
    Match.tag('mutationTestReportReady', (ready) => Result.succeed(ready.report)),
    Match.orElse(() => Result.fail('not-ready' as const)),
  )
)

type Reported = (typeof SarifReportCommand)['Encoded']['reported']

const NOT_REPORTED: Reported = { _tag: 'SarifNotReported' }

const readSarifReport = (input: {
  readonly options: Options.StrykerOptions
  readonly events: AsyncIterable<Reporter.ReporterEvent>
}) => {
  const survivorsOf = surfacedSurvivorsOf({
    perLine: input.options.surfacing.perLine,
    perFile: input.options.surfacing.perFile,
  })
  return Effect.map(
    Stream.fromAsyncIterable(input.events, failAsSarif).pipe(
      Stream.filterMap(reportOf),
      Stream.runFold(
        (): Reported => NOT_REPORTED,
        (_, report): Reported => ({ _tag: 'SarifReported', report, survivors: survivorsOf(report) }),
      ),
    ),
    (reported) => ({
      _tag: 'SarifReportCommand' as const,
      reported,
      tool: {
        name: 'StrykerJS',
        version: StrykerPackage.version,
        informationUri: STRYKER_INFORMATION_URI,
      },
      maxResults: SARIF_MAX_RESULTS,
      options: input.options,
    }),
  )
}

const writeSarifReport = (log: SarifLog, raw: { readonly options: Options.StrykerOptions }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown, { space: 2 }))(log)
    const fileName = path.resolve(sarifFileNameOf(raw.options.jsonReporter.fileName))
    yield* fs.makeDirectory(path.dirname(fileName), { recursive: true })
    yield* fs.writeFileString(fileName, json)
  }).pipe(Effect.mapError(failAsSarif))

export const sarifReportCell = Sandwich.named(SpanTaxonomy.Spans.reportSarif.name)(readSarifReport)
  .decide(sarifReport)
  .write({
    SarifReportRendered: ({ log }, raw) => writeSarifReport(log, raw),
    SarifReportTruncated: ({ log }, raw) => writeSarifReport(log, raw),
    SarifReportSuppressed: () => Effect.void,
    CommandRejected: ({ issue }) => Effect.fail(failAsSarif(issue)),
  })
