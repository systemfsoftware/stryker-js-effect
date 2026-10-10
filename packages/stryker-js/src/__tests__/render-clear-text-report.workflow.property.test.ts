import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ClearTextRenderOptions,
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
    })
  ),
)

const coherentArb = Arbitrary.all({
  report: Arbitrary.schema(Report.MutationTestResult),
  computed: Arbitrary.schema(Report.MetricsResultSchema),
  render: Arbitrary.schema(ClearTextRenderOptions),
})

const fileRowsOf = (metrics: Report.MetricsResult): number =>
  1 + Arr.reduce(metrics.childResults, 0, (rows, child) => rows + fileRowsOf(child))

const TABLE_CHROME_ROWS = 5

const tableBodyRowsOf = (rendered: ClearTextReportRendered): number =>
  Option.match(Arr.last(rendered.stdout), {
    onNone: () => -1,
    onSome: (table) => table.length - TABLE_CHROME_ROWS,
  })

const STATIC_SUMMARY_PREFIX = 'Static mutants: '

const staticSummaryTextsOf = (rendered: ClearTextReportRendered): ReadonlyArray<string> =>
  Arr.flatMap(rendered.stdout, (chunk) => Arr.flatMap(chunk, (line) => Arr.map(line, (span) => span.text)))
    .filter((text) => text.startsWith(STATIC_SUMMARY_PREFIX))

const erroredArb = Arbitrary.all({
  report: Arbitrary.schema(Report.MutationTestResult),
  file: Arbitrary.schema(Report.FileResult),
  mutant: Arbitrary.schema(Report.MutantResult),
  computed: Arbitrary.schema(Report.MetricsResultSchema),
  render: Arbitrary.schema(ClearTextRenderOptions),
  detail: Arbitrary.schema(S.String),
  compile: Arbitrary.schema(S.Boolean),
  remembered: Arbitrary.schema(S.Boolean),
})

const ERROR_MESSAGE = 'Error message: '

const withOnlyMutant = (
  report: Report.MutationTestResult,
  file: Report.FileResult,
  mutant: Report.MutantResult,
): Report.MutationTestResult => ({ ...report, files: { 'src/a.ts': { ...file, mutants: [mutant] } } })

const errorMessagesOf = (rendered: ClearTextReportRendered): ReadonlyArray<string> =>
  Arr.flatMap(
    [...rendered.stdout, ...rendered.diagnostics],
    (chunk) =>
      Arr.flatMap(chunk, (line) =>
        Option.match(Arr.head(line), {
          onNone: () => [],
          onSome: (first) => first.text === ERROR_MESSAGE ? [line.slice(1).map((span) => span.text).join('')] : [],
        })),
  )

describe('renderClearTextReport', () => {
  it.prop(
    '∀c_Command_≡SuppressedIffNoTerminalReport',
    { of: [commandArb], subject: renderClearTextReport },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (value) =>
          Match.value(value).pipe(
            Match.tag(
              'ClearTextReportSuppressed',
              () => command.reported === undefined || command.computed === undefined,
            ),
            Match.tag(
              'ClearTextReportRendered',
              () => command.reported !== undefined && command.computed !== undefined,
            ),
            Match.exhaustive,
          ),
      }),
  )

  it.prop(
    '∀c_ColorOff_≡PlainSpans',
    { of: [colorOffArb], subject: renderClearTextReport },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (value) =>
          Match.value(value).pipe(
            Match.tag(
              'ClearTextReportRendered',
              (rendered) => spansOf(rendered).every((span) => span.tone === 'plain'),
            ),
            Match.tag('ClearTextReportSuppressed', () => true),
            Match.exhaustive,
          ),
      }),
  )

  it.prop(
    '∀c_StaticSummary_≡PresentExactlyWhenSupplied',
    { of: [commandArb], subject: renderClearTextReport },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (value) =>
          Match.value(value).pipe(
            Match.tag('ClearTextReportRendered', (rendered) => {
              const summaries = staticSummaryTextsOf(rendered)
              const [first] = summaries
              const supplied = command.static
              return supplied === undefined
                ? summaries.length === 0
                : summaries.length === 1 && first !== undefined && first.includes(String(supplied.count))
            }),
            Match.tag('ClearTextReportSuppressed', () => true),
            Match.exhaustive,
          ),
      }),
  )

  it.prop(
    '∀rcs_Metrics_≡OneTableRowPerFile',
    { of: [coherentArb], subject: renderClearTextReport },
    (subject, [{ report, computed, render }]) =>
      Result.match(
        subject(
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
      ),
  )

  it.prop(
    '∀d_ErroredReason_≡DetailWithoutCodes',
    { of: [erroredArb], subject: renderClearTextReport },
    (subject, [{ report, file, mutant, computed, render, detail, compile, remembered }]) => {
      const status = compile ? 'CompileError' : 'RuntimeError'
      const coded = `${compile ? 'compile-error' : 'runtime-error'}: ${detail}`
      const statusReason = remembered ? `remembered: ${coded}` : coded
      return Result.match(
        subject(
          ClearTextReportCommand.make({
            reported: withOnlyMutant(report, file, { ...mutant, status, statusReason }),
            computed,
            render: { ...render, reportMutants: true },
            rendered: true,
          }),
        ),
        {
          onFailure: () => false,
          onSuccess: (value) =>
            Match.value(value).pipe(
              Match.tag('ClearTextReportRendered', (rendered) => {
                const messages = errorMessagesOf(rendered)
                return messages.length === 1 && messages[0] === detail
              }),
              Match.tag('ClearTextReportSuppressed', () => false),
              Match.exhaustive,
            ),
        },
      )
    },
  )
})
