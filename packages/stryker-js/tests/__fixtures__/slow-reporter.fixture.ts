import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'

/**
 * A reporter plugin that pulls its events from the run one macrotask turn at a
 * time, so it is always behind the run that publishes them. The turns are real
 * event-loop turns (`setImmediate`), never timers: the consumer is slow because
 * of the work it does between two events, not because it sleeps.
 */
export const SlowConsumer = {
  millisecondsPerEvent: 750,
  calibrationTurns: 20_000,
} as const

const nextEventLoopTurn: Effect.Effect<void> = Effect.callback<void>((resume) => {
  const handle = setImmediate(() => {
    resume(Effect.void)
  })
  return Effect.sync(() => {
    clearImmediate(handle)
  })
})

const yieldEventLoopTurns = (turns: number): Effect.Effect<void> =>
  turns <= 0 ? Effect.void : nextEventLoopTurn.pipe(Effect.andThen(() => yieldEventLoopTurns(turns - 1)))

export const turnsCostingMilliseconds = (milliseconds: number): Effect.Effect<number> =>
  Effect.gen(function*() {
    const startedAt = performance.now()
    yield* yieldEventLoopTurns(SlowConsumer.calibrationTurns)
    const elapsed = Math.max(performance.now() - startedAt, 1)
    return Math.max(1, Math.ceil((milliseconds * SlowConsumer.calibrationTurns) / elapsed))
  })

export const SlowReporterObservationSchema = S.Struct({
  eventTags: S.Array(S.String),
  terminalReportReady: S.Boolean,
  terminalReportFiles: S.Array(S.String),
  terminalMutantsTotal: S.Int,
  terminalMutantsKilled: S.Int,
  terminalMutantsSurvived: S.Int,
  turnsPerEvent: S.Int,
})

export type SlowReporterObservation = typeof SlowReporterObservationSchema.Type

export interface SlowReporterSettings {
  readonly markerPath: string
  readonly turnsPerEvent: number
}

const mutate = (terminal: Reporter.MutationTestReportReady) => ({
  terminalReportFiles: Object.keys(terminal.report.files).sort(),
  terminalMutantsTotal: terminal.metrics.metrics.totalMutants,
  terminalMutantsKilled: terminal.metrics.metrics.killed,
  terminalMutantsSurvived: terminal.metrics.metrics.survived,
})

const eventStream = (
  events: AsyncIterable<Reporter.ReporterEvent>,
): Stream.Stream<Reporter.ReporterEvent, Reporter.ReporterFailed> =>
  Stream.fromAsyncIterable(
    events,
    (cause) =>
      Reporter.ReporterFailed.make({
        reporterName: 'slow-reporter',
        event: 'mutationTestReportReady',
        cause: cause instanceof Error ? cause.message : 'the slow reporter failed while draining the run',
      }),
  )

const writeObservation = (markerPath: string, observation: SlowReporterObservation): void => {
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileSync(markerPath, JSON.stringify(observation), 'utf8')
}

const consumeEvent = (
  settings: SlowReporterSettings,
  seen: Ref.Ref<ReadonlyArray<string>>,
  received: Ref.Ref<Option.Option<Reporter.MutationTestReportReady>>,
) =>
(event: Reporter.ReporterEvent): Effect.Effect<void> =>
  Effect.gen(function*() {
    yield* Ref.update(seen, (tags) => [...tags, event._tag])
    if (S.is(Reporter.MutationTestReportReady)(event)) {
      yield* Ref.set(received, Option.some(event))
    }
    yield* yieldEventLoopTurns(settings.turnsPerEvent)
  })

export const makeSlowReporter =
  (settings: SlowReporterSettings): Reporter.ReporterFactory => (_options, _init) => (events) =>
    Effect.gen(function*() {
      const seen = yield* Ref.make<ReadonlyArray<string>>([])
      const received = yield* Ref.make<Option.Option<Reporter.MutationTestReportReady>>(Option.none())
      yield* Stream.runForEach(eventStream(events), consumeEvent(settings, seen, received))
      const terminal = yield* Ref.get(received)
      const observation: SlowReporterObservation = {
        eventTags: yield* Ref.get(seen),
        terminalReportReady: Option.isSome(terminal),
        ...Option.match(terminal, {
          onNone: () => ({
            terminalReportFiles: [],
            terminalMutantsTotal: 0,
            terminalMutantsKilled: 0,
            terminalMutantsSurvived: 0,
          }),
          onSome: mutate,
        }),
        turnsPerEvent: settings.turnsPerEvent,
      }
      yield* Effect.sync(() => {
        writeObservation(settings.markerPath, observation)
      })
    })
