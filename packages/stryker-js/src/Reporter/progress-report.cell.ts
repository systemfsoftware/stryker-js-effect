import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'

import { advanceProgressReport, type ProgressState } from './advance-progress-report.workflow.js'
import { renderProgressLineBreak, renderProgressTick } from './render-progress-report.js'
import { failAsReporter } from './reporter-failed.js'
import { ProgressReporterName } from './reporter-name.js'
import { ReporterOutput } from './reporter-output.service.js'

const failAsProgress = failAsReporter(ProgressReporterName)

const readProgressStep = (input: {
  readonly state: ProgressState
  readonly event: Reporter.ReporterEvent | undefined
}) =>
  Effect.map(Clock.currentTimeMillis, (now) => ({
    _tag: 'ProgressReportCommand' as const,
    state: input.state,
    event: input.event,
    now,
  }))

const writeChunk = (chunk: string) =>
  Effect.flatMap(ReporterOutput, (output) => Effect.ignore(output.write('stdout', [chunk])))

export const progressReportCell = Sandwich.named(SpanTaxonomy.Spans.reportProgress.name)(readProgressStep)
  .decide(advanceProgressReport)
  .write({
    ProgressBarTicked: ({ bar, state }, { now }) =>
      Effect.as(writeChunk(renderProgressTick({ bar, tally: state.tally, now })), state),
    ProgressBarLeftIncomplete: ({ state }) => Effect.as(writeChunk(renderProgressLineBreak()), state),
    ProgressRecorded: ({ state }) => Effect.succeed(state),
    CommandRejected: ({ issue }) => Effect.fail(failAsProgress(issue)),
  })
