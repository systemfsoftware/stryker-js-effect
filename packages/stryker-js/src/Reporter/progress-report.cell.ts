import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'

import { advanceProgress, type ProgressStepOutput } from './advance-progress-report.js'
import { ProgressReportCommand, type ProgressState } from './progress-report.schema.js'
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

const writeStep = (step: ProgressStepOutput) =>
  Effect.as(Effect.flatMap(ReporterOutput, (output) => Effect.ignore(output.write('stdout', step.stdout))), step.state)

export const progressReportCell = Sandwich.writer(SpanTaxonomy.Spans.reportProgress.name)(readProgressStep)
  .decode(ProgressReportCommand)
  .write({
    Decoded: (command) => writeStep(advanceProgress(command)),
    CommandRejected: ({ issue }) => Effect.fail(failAsProgress(issue)),
  })
