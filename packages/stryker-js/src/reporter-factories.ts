import { Cell } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import { clearTextReportCell } from './clear-text-report.cell.js'
import { jsonReportCell } from './json-report.cell.js'
import { progressReportCell } from './progress-report.cell.js'
import type { ProgressState, ProgressTally } from './render-progress-report.workflow.js'
import { failAsProgress } from './reporter-failures.js'

type ReporterCellServices<C> = C extends Cell.Cell<infer _I, infer _A, infer _E, infer S> ? S : never

const emptyTally = (startedAt: number): ProgressTally => ({
  survived: 0,
  timedOut: 0,
  tested: 0,
  mutants: 0,
  total: 0,
  ticks: 0,
  ticksByMutantId: {},
  timing: { net: 0, overhead: 0 },
  capabilities: { reloadEnvironment: false },
  startedAt,
})

const INITIAL_PROGRESS: ProgressState = { tally: emptyTally(0), bar: null }

export const clearTextReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof clearTextReportCell>>,
): Reporter.ReporterFactory => {
  const report = Cell.provideContext(clearTextReportCell, context)
  return (options) => (events) => Effect.asVoid(report.run({ options, events }))
}

export const jsonReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof jsonReportCell>>,
): Reporter.ReporterFactory => {
  const report = Cell.provideContext(jsonReportCell, context)
  return (options) => (events) => Effect.asVoid(report.run({ options, events }))
}

export const progressReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof progressReportCell>>,
): Reporter.ReporterFactory => {
  const step = Cell.provideContext(progressReportCell, context)
  const consumeEvent = Effect.fn(SpanTaxonomy.Spans.reportProgressConsumeEvent.name)(function*(
    state: Ref.Ref<ProgressState>,
    event: Reporter.ReporterEvent,
  ) {
    const current = yield* Ref.get(state)
    const next = yield* step.run({ state: current, event })
    yield* Ref.set(state, next)
  })
  return () =>
    Effect.fn(SpanTaxonomy.Spans.reportProgressConsume.name)(function*(
      events: AsyncIterable<Reporter.ReporterEvent>,
    ) {
      const state = yield* Ref.make<ProgressState>(INITIAL_PROGRESS)
      yield* Stream.runForEach(
        Stream.fromAsyncIterable(events, failAsProgress),
        (event) => consumeEvent(state, event),
      )
      yield* step.run({ state: yield* Ref.get(state), event: undefined })
    })
}
