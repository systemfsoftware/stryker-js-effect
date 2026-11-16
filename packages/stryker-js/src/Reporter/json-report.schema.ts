import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class JsonReportCommand
  extends S.TaggedClass<JsonReportCommand, { readonly brand: unique symbol }>()('JsonReportCommand', {
    reports: S.Array(Report.MutationTestResult),
    debug: S.Boolean,
    fileName: S.String,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}
