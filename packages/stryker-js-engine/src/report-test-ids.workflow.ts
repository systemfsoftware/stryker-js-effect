import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { type ReuseTestFile, type ReuseTestFiles, ReuseTestFilesSchema } from './IncrementalReuse.schema.js'

const ReportTestIdTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ReportTestId')
type ReportTestIdTypeId = typeof ReportTestIdTypeId

export class ReportTestId extends S.TaggedClass<ReportTestId>()('ReportTestId', {
  positionalId: S.String,
  runnerTestId: S.String,
}) {
  readonly [ReportTestIdTypeId] = ReportTestIdTypeId
}

export class ResolveReportTestIds extends S.TaggedClass<ResolveReportTestIds>()('ResolveReportTestIds', {
  testFiles: S.optional(ReuseTestFilesSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const EMPTY_TEST_FILES: ReuseTestFiles = {}

const runnerTestIdOf = (file: string, name: string): string => `${file}#${name}`

const testIdsOfFile = (file: string, testFile: ReuseTestFile): readonly ReportTestId[] =>
  testFile.tests.map((test) =>
    ReportTestId.make({ positionalId: test.id, runnerTestId: runnerTestIdOf(file, test.name) })
  )

const testIdsOfFiles = (testFiles: ReuseTestFiles): readonly ReportTestId[] =>
  Object.entries(testFiles).flatMap(([file, testFile]) => testIdsOfFile(file, testFile))

const tableOf = (testFiles: ReuseTestFiles | undefined): readonly ReportTestId[] =>
  testIdsOfFiles(Option.getOrElse(Option.fromUndefinedOr(testFiles), () => EMPTY_TEST_FILES))

const decide = (command: ResolveReportTestIds): Result.Result<readonly ReportTestId[], never> =>
  Result.succeed(tableOf(command.testFiles))

export const reportTestIds = Workflow.make({
  command: ResolveReportTestIds,
  decision: S.Array(ReportTestId),
  error: S.Never,
  decide,
})
