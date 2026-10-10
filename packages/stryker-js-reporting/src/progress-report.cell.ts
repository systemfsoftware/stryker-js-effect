import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'

import { Reports } from '@systemfsoftware/stryker-js-contracts'
import { type ProgressState, renderProgressReport } from './render-progress-report.workflow.js'
import { failAsProgress } from './reporter-failures.js'

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
  Effect.flatMap(Reports.ReporterOutput, (output) => Effect.ignore(output.write('stdout', [chunk])))

export const progressReportCell = Sandwich.named(SpanTaxonomy.Spans.reportProgress.name)(readProgressStep)
  .decide(renderProgressReport)
  .write({
    ProgressBarTick: ({ chunk, state }) => Effect.as(writeChunk(chunk), state),
    ProgressLineBreak: ({ chunk, state }) => Effect.as(writeChunk(chunk), state),
    ProgressChunkSuppressed: ({ state }) => Effect.succeed(state),
    CommandRejected: ({ issue }) => Effect.fail(failAsProgress(issue)),
  })
