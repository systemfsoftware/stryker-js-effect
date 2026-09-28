import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const DecodeMutationTestResult = S.decodeResult(S.fromJsonString(Report.MutationTestResult))

export class DecodeReportCommand extends S.TaggedClass<DecodeReportCommand>()('DecodeReportCommand', {
  file: S.String,
  text: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const ReportDecodedTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/ReportDecoded')
type ReportDecodedTypeId = typeof ReportDecodedTypeId

export class ReportDecoded extends S.TaggedClass<ReportDecoded>()('ReportDecoded', {
  report: Report.MutationTestResult,
}) {
  readonly [ReportDecodedTypeId] = ReportDecodedTypeId
}

export class ReportUndecodable extends S.TaggedError<ReportUndecodable>()('ReportUndecodable', {
  file: S.String,
  reason: S.String,
}) {
  override get message(): string {
    return `${this.file} decodes under no report contract document: ${this.reason}`
  }
}

const decide = (command: DecodeReportCommand): Result.Result<ReportDecoded, ReportUndecodable> =>
  Result.match(DecodeMutationTestResult(command.text), {
    onFailure: (issue) => Result.fail(ReportUndecodable.make({ file: command.file, reason: issue.message })),
    onSuccess: (report) => Result.succeed(ReportDecoded.make({ report })),
  })

export const decodeReport = Workflow.make({
  command: DecodeReportCommand,
  decision: ReportDecoded,
  error: ReportUndecodable,
  decide,
})
