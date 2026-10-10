import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const IncrementalReportSubset = S.Struct({
  files: S.Record(
    S.String,
    S.Struct({ mutants: S.Array(S.Struct({ coveredBy: S.String.pipe(S.Array, S.optionalKey) })) }),
  ),
  testFiles: S.Record(S.String, S.Struct({ tests: S.Array(S.Struct({ id: S.String })) })),
})

const DecodeReport = S.decodeResult(S.fromJsonString(IncrementalReportSubset))

type IncrementalReport = typeof IncrementalReportSubset.Type

export class CoveringTestFilesCommand extends S.TaggedClass<CoveringTestFilesCommand>()('CoveringTestFilesCommand', {
  report: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const CoveringTestFilesFoundTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-e2e-core/CoveringTestFilesFound',
)
type CoveringTestFilesFoundTypeId = typeof CoveringTestFilesFoundTypeId

export class CoveringTestFilesFound extends S.TaggedClass<CoveringTestFilesFound>()('CoveringTestFilesFound', {
  mutatedFiles: S.Array(S.String),
  testFiles: S.Array(S.String),
}) {
  readonly [CoveringTestFilesFoundTypeId] = CoveringTestFilesFoundTypeId
}

export class IncrementalReportUnreadable extends S.TaggedError<IncrementalReportUnreadable>()(
  'IncrementalReportUnreadable',
  { reason: S.String },
) {
  override get message(): string {
    return `the run's incremental report is unreadable: ${this.reason}`
  }
}

const testFileByIdOf = (testFiles: IncrementalReport['testFiles']): Record.ReadonlyRecord<string, string> =>
  Record.fromEntries(
    Arr.flatMap(
      Record.toEntries(testFiles),
      ([testFile, definition]) => Arr.map(definition.tests, (test) => [test.id, testFile] as const),
    ),
  )

const coveringIdsOf = (files: IncrementalReport['files']): ReadonlyArray<string> =>
  Arr.flatMap(
    Record.values(files),
    (file) =>
      Arr.flatMap(file.mutants, (mutant) =>
        Arr.fromIterable(Option.getOrElse(Option.fromNullishOr(mutant.coveredBy), () => []))),
  )

const coveringFileNamesOf = (
  files: IncrementalReport['files'],
  testFileById: Record.ReadonlyRecord<string, string>,
): Result.Result<ReadonlyArray<string>, string> =>
  Result.map(
    Result.all(
      Arr.map(Arr.dedupe(coveringIdsOf(files)), (id) => Result.fromOption(Record.get(testFileById, id), () => id)),
    ),
    (testFiles) => Arr.sort(Arr.dedupe(testFiles), Order.String),
  )

const decide = (
  command: CoveringTestFilesCommand,
): Result.Result<CoveringTestFilesFound, IncrementalReportUnreadable> =>
  Result.match(DecodeReport(command.report), {
    onFailure: (issue) => Result.fail(IncrementalReportUnreadable.make({ reason: issue.message })),
    onSuccess: (report) =>
      Result.match(coveringFileNamesOf(report.files, testFileByIdOf(report.testFiles)), {
        onFailure: (id) =>
          Result.fail(
            IncrementalReportUnreadable.make({ reason: `covering id '${id}' names no test in the report's testFiles` }),
          ),
        onSuccess: (testFiles) =>
          Result.succeed(
            CoveringTestFilesFound.make({
              mutatedFiles: Arr.sort(Record.keys(report.files), Order.String),
              testFiles,
            }),
          ),
      }),
  })

export const coveringTestFiles = Workflow.make({
  command: CoveringTestFilesCommand,
  decision: CoveringTestFilesFound,
  error: IncrementalReportUnreadable,
  decide,
})
