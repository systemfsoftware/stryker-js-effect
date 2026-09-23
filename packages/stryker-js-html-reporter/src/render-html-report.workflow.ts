import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Option, Schema } from 'effect'
import * as Result from 'effect/Result'

const RenderHtmlReportTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-html-reporter/RenderHtmlReportDecision',
)
type RenderHtmlReportTypeId = typeof RenderHtmlReportTypeId

export class RenderHtmlReport extends Schema.TaggedClass<RenderHtmlReport>()('RenderHtmlReport', {
  fileName: Schema.String,
  inlinedBundle: Schema.UndefinedOr(Schema.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    fileName: 'stryker.html_report.file_name',
  } as const
}

export class BundleInlined extends Schema.TaggedClass<BundleInlined>()('BundleInlined', {
  bundle: Schema.String,
}) {
  readonly [RenderHtmlReportTypeId] = RenderHtmlReportTypeId
}

export class BundleFromDisk extends Schema.TaggedClass<BundleFromDisk>()('BundleFromDisk', {}) {
  readonly [RenderHtmlReportTypeId] = RenderHtmlReportTypeId
}

export const RenderHtmlReportDecision = Schema.Union([BundleInlined, BundleFromDisk])
export type RenderHtmlReportDecision = typeof RenderHtmlReportDecision.Type

export const renderHtmlReport = Workflow.make({
  command: RenderHtmlReport,
  decision: RenderHtmlReportDecision,
  error: Schema.Never,
  decide: ({ inlinedBundle }) =>
    Result.succeed(
      Option.match(Option.fromNullishOr(inlinedBundle), {
        onNone: () => BundleFromDisk.make({}),
        onSome: (bundle) => BundleInlined.make({ bundle }),
      }),
    ),
})
