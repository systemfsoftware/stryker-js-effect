import { Workflow } from '@systemfsoftware/effect-cell-types'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const STREAM_THRESHOLDS = { high: 100, low: 80, break: null }

const ReportFromStreamTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ReportFromStream')
type ReportFromStreamTypeId = typeof ReportFromStreamTypeId

export class ReportFromStreamCommand extends S.Class<ReportFromStreamCommand>('ReportFromStreamCommand')({
  text: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = { text: 'stryker.report.stream.text' } as const
}

export class ReportFromStreamRebuilt extends S.TaggedClass<ReportFromStreamRebuilt>()('ReportFromStreamRebuilt', {
  report: Report.MutationTestResult,
}) {
  readonly [ReportFromStreamTypeId] = ReportFromStreamTypeId
}

export class ReportFromStreamAbsent extends S.TaggedClass<ReportFromStreamAbsent>()('ReportFromStreamAbsent', {}) {
  readonly [ReportFromStreamTypeId] = ReportFromStreamTypeId
}

const presentText = (field: string, value: string | null): Readonly<Record<string, string>> =>
  Option.match(Option.fromNullOr(value), {
    onNone: () => ({}),
    onSome: (present) => ({ [field]: present }),
  })

const mutantFromStream = (line: RunEvent.RunMutantTested): Report.MutantResult => ({
  id: line.id,
  mutatorName: line.mutatorName,
  status: line.status,
  location: line.location,
  ...presentText('replacement', line.replacement),
  ...presentText('statusReason', line.statusReason),
})

const decodeLineText = S.decodeOption(S.fromJsonString(RunEvent.RunMutantTested))

const streamLines = (text: string) => text.split('\n').flatMap((raw) => Option.toArray(decodeLineText(raw.trim())))

const rebuiltReport = (text: string): Option.Option<Report.MutationTestResult> => {
  const grouped = Arr.groupBy(streamLines(text), (line) => line.fileName)
  return Option.map(
    Option.liftPredicate(grouped, (files) => !Record.isEmptyRecord(files)),
    (files) => ({
      schemaVersion: '1.0',
      thresholds: STREAM_THRESHOLDS,
      files: Record.map(files, (lines) => ({
        language: 'javascript',
        source: '',
        mutants: Arr.map(lines, mutantFromStream),
      })),
    }),
  )
}

const decideReportFromStream = (command: ReportFromStreamCommand): ReportFromStreamRebuilt | ReportFromStreamAbsent =>
  Option.match(rebuiltReport(command.text), {
    onNone: () => ReportFromStreamAbsent.make({}),
    onSome: (report) => ReportFromStreamRebuilt.make({ report }),
  })

export const reportFromStream = Workflow.make({
  command: ReportFromStreamCommand,
  decision: S.Union([ReportFromStreamRebuilt, ReportFromStreamAbsent]),
  error: S.Never,
  decide: (
    command,
  ): Result.Result<ReportFromStreamRebuilt | ReportFromStreamAbsent, never> =>
    Result.succeed(decideReportFromStream(command)),
})
