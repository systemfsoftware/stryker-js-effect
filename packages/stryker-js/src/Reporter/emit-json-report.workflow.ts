import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const JsonReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/JsonReport')
type JsonReportTypeId = typeof JsonReportTypeId

export class JsonReportCommand
  extends S.TaggedClass<JsonReportCommand, { readonly brand: unique symbol }>()('JsonReportCommand', {
    reported: S.optional(Report.MutationTestResult),
    debug: S.Boolean,
    fileName: S.String,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class JsonReportEmitted
  extends S.TaggedClass<JsonReportEmitted, { readonly brand: unique symbol }>()('JsonReportEmitted', {
    report: Report.MutationTestResult,
    announceFileName: S.Option(S.String),
  })
{
  readonly [JsonReportTypeId] = JsonReportTypeId
}

export class JsonReportSuppressed
  extends S.TaggedClass<JsonReportSuppressed, { readonly brand: unique symbol }>()('JsonReportSuppressed', {})
{
  readonly [JsonReportTypeId] = JsonReportTypeId
}

export const JsonReportDecision = S.Union([JsonReportEmitted, JsonReportSuppressed])
export type JsonReportDecision = typeof JsonReportDecision.Type

export const emitJsonReport = Workflow.make({
  command: JsonReportCommand,
  decision: JsonReportDecision,
  error: S.Never,
  decide: (command) =>
    Option.match(Option.fromUndefinedOr(command.reported), {
      onNone: () => Result.succeed(JsonReportSuppressed.make({})),
      onSome: (report) =>
        Result.succeed(
          JsonReportEmitted.make({
            report,
            announceFileName: Boolean.match(command.debug, {
              onTrue: () => Option.some(command.fileName),
              onFalse: () => Option.none<string>(),
            }),
          }),
        ),
    }),
})
