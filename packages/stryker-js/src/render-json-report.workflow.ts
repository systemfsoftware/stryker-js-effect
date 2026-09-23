import { Workflow } from '@systemfsoftware/effect-cell-types'
import { MutationTestResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const JsonReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/JsonReport')
type JsonReportTypeId = typeof JsonReportTypeId

export class JsonReportCommand extends S.TaggedClass<JsonReportCommand>()('JsonReportCommand', {
  reported: S.optional(MutationTestResultSchema),
  rendered: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = { rendered: 'stryker.report.render' } as const
}

export class JsonReportRendered extends S.TaggedClass<JsonReportRendered>()('JsonReportRendered', {
  json: S.String,
}) {
  readonly [JsonReportTypeId] = JsonReportTypeId
}

export class JsonReportSuppressed extends S.TaggedClass<JsonReportSuppressed>()('JsonReportSuppressed', {}) {
  readonly [JsonReportTypeId] = JsonReportTypeId
}

export class JsonReportRefused extends S.TaggedError<JsonReportRefused>()('JsonReportRefused', {
  cause: S.Unknown,
}) {
  readonly [JsonReportTypeId] = JsonReportTypeId
}

export const JsonReportDecision = S.Union([JsonReportRendered, JsonReportSuppressed])
export type JsonReportDecision = typeof JsonReportDecision.Type

export const renderJsonReport = Workflow.make({
  command: JsonReportCommand,
  decision: JsonReportDecision,
  error: JsonReportRefused,
  decide: (command) =>
    Option.match(Option.fromUndefinedOr(command.reported), {
      onNone: () => Result.succeed(JsonReportSuppressed.make({})),
      onSome: (report) =>
        Result.mapBoth(S.encodeResult(S.fromJsonString(S.Unknown, { space: 0 }))(report), {
          onFailure: (cause) => JsonReportRefused.make({ cause }),
          onSuccess: (json) => JsonReportRendered.make({ json }),
        }),
    }),
})
