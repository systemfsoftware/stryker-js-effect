import { describe, it } from '@effect/vitest'
import { MutationTestResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import type { MetricsResult } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { calculateMetrics } from '../calculate-metrics.js'
import {
  ClearTextReportCommand,
  ClearTextReportRendered,
  renderClearTextReport,
} from '../render-clear-text-report.workflow.js'

const commandArb = Arbitrary.schema(ClearTextReportCommand)

const spansOf = (rendered: ClearTextReportRendered) => [...rendered.stdout, ...rendered.diagnostics].flat(2)

const colorOffArb = commandArb.pipe(
  Arbitrary.map((command) =>
    ClearTextReportCommand.make({
      reported: command.reported,
      computed: command.computed,
      render: { ...command.render, allowColor: false },
      rendered: command.rendered,
    }),
  ),
)

const coherentArb = Arbitrary.all({
  report: Arbitrary.schema(MutationTestResultSchema),
  render: Arbitrary.schema(ClearTextRenderOptions),
})

const fileRowsOf = (metrics: MetricsResult): number =>
  1 + Arr.reduce(metrics.childResults, 0, (rows, child) => rows + fileRowsOf(child))

const TABLE_CHROME_ROWS = 5

const tableBodyRowsOf = (rendered: ClearTextReportRendered): number =>
  Option.match(Arr.last(rendered.stdout), {
    onNone: () => -1,
    onSome: (table) => table.length - TABLE_CHROME_ROWS,
  })

describe('renderClearTextReport', () => {
  it.prop('∀c_SuppressedIffNoTerminalReport', [commandArb], ([command]) =>
    Result.match(renderClearTextReport(command), {
      onFailure: () => false,
      onSuccess: (value) =>
        Match.value(value).pipe(
          Match.tag('ClearTextReportSuppressed', () =>
            command.reported === undefined || command.computed === undefined),
          Match.tag('ClearTextReportRendered', () =>
            command.reported !== undefined && command.computed !== undefined),
          Match.exhaustive,
        ),
    }))

  it.prop('∀c_ColorOff_≡PlainSpans', [colorOffArb], ([command]) =>
    Result.match(renderClearTextReport(command), {
      onFailure: () => false,
      onSuccess: (value) =>
        Match.value(value).pipe(
          Match.tag('ClearTextReportRendered', (rendered) =>
            spansOf(rendered).every((span) => span.tone === 'plain')),
          Match.tag('ClearTextReportSuppressed', () => true),
          Match.exhaustive,
        ),
    }))

  it.prop('∀cs_Report_≡OneTableRowPerFile', [coherentArb], ([{ report, render }]) => {
    const computed = calculateMetrics(report.files)
    return Result.match(
      renderClearTextReport(
        ClearTextReportCommand.make({
          reported: report,
          computed,
          render: { ...render, reportScoreTable: true, skipFull: false },
          rendered: true,
        }),
      ),
      {
        onFailure: () => false,
        onSuccess: (value) =>
          Match.value(value).pipe(
            Match.tag('ClearTextReportRendered', (rendered) => tableBodyRowsOf(rendered) === fileRowsOf(computed)),
            Match.tag('ClearTextReportSuppressed', () => false),
            Match.exhaustive,
          ),
      },
    )
  })
})
