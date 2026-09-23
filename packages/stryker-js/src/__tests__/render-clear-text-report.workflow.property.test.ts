import { describe, it } from '@effect/vitest'
import { Arbitrary } from 'effect/unstable/arbitrary'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import {
  ClearTextReportCommand,
  ClearTextReportRendered,
  renderClearTextReport,
} from '../render-clear-text-report.workflow.js'

const commandArb = Arbitrary.schema(ClearTextReportCommand)

const colorOffArb = commandArb.pipe(
  Arbitrary.map((command) => ({
    ...command,
    render: { ...command.render, allowColor: false },
  })),
)

const spansOf = (rendered: ClearTextReportRendered) => [...rendered.stdout, ...rendered.diagnostics].flat(2)

describe('renderClearTextReport', () => {
  it.prop('∀c_SuppressedIffNoTerminalReport', [commandArb], ([command]) =>
    Result.match(renderClearTextReport(command), {
      onFailure: () => false,
      onSuccess: (value) =>
        (value._tag === 'ClearTextReportSuppressed') ===
        (command.reported === undefined || command.computed === undefined),
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
})
