import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import { type ProgressState, type ProgressTally, renderProgressReport } from './render-progress-report.workflow.js'
import { ReporterOutput } from './reporter-output.service.js'

const failAsProgress = <E = unknown>(cause: E): Reporter.ReporterFailed =>
  Reporter.ReporterFailed.make({
    reporterName: 'progress',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(cause), (rendered) => rendered.text), () => ''),
  })

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

export const progressReportCell = Sandwich.named('stryker.report.progress')(readProgressStep)
  .decide(renderProgressReport)
  .write({
    ProgressBarTick: ({ chunk, state }) => Effect.as(writeChunk(chunk), state),
    ProgressLineBreak: ({ chunk, state }) => Effect.as(writeChunk(chunk), state),
    ProgressChunkSuppressed: ({ state }) => Effect.succeed(state),
    CommandRejected: ({ issue }) => Effect.fail(failAsProgress(issue)),
  })

type ReporterCellServices<C> = C extends Cell.Cell<infer _I, infer _A, infer _E, infer S> ? S : never

export const progressReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof progressReportCell>>,
): Reporter.ReporterFactory => {
  const step = Cell.provideContext(progressReportCell, context)
  const consumeEvent = Effect.fn('stryker.report.progress.consumeEvent')(function*(
    state: Ref.Ref<ProgressState>,
    event: Reporter.ReporterEvent,
  ) {
    const current = yield* Ref.get(state)
    const next = yield* step.run({ state: current, event })
    yield* Ref.set(state, next)
  })
  return () =>
    Effect.fn('stryker.report.progress.consume')(function*(events: AsyncIterable<Reporter.ReporterEvent>) {
      const state = yield* Ref.make<ProgressState>(INITIAL_PROGRESS)
      yield* Stream.runForEach(
        Stream.fromAsyncIterable(events, failAsProgress),
        (event) => consumeEvent(state, event),
      )
      yield* step.run({ state: yield* Ref.get(state), event: undefined })
    })
}
