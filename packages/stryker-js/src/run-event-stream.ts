import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

import {
  frameRunEvent,
  FrameRunEventCommand,
  type FrameRunEventDecision,
  FramingState,
  type ResolvedModeInput,
} from './frame-run-event.workflow.js'
import { RunEventWireLine } from './run-event-wire.schema.js'
import { RUN_EVENTS_QUEUE_BOUND } from './Run.js'
import { Heartbeat, RunEvent, RunStarted } from './RunEvent.schema.js'
import { STREAM_SCHEMA_VERSION } from './StreamVersion.js'
import { generateRunId } from './verdict-envelope.js'

export type { ResolvedModeInput } from './frame-run-event.workflow.js'

export const TICK_INTERVAL_MS = 10_000

export const initialFramingState = (resolved: ResolvedModeInput): FramingState =>
  FramingState.make({
    mode: resolved.mode,
    signal: resolved.signal,
    headerWritten: false,
    terminalSeen: false,
    completed: 0,
    total: null,
  })

const markWritten = (state: FramingState): FramingState =>
  FramingState.make({
    mode: state.mode,
    signal: state.signal,
    headerWritten: true,
    terminalSeen: state.terminalSeen,
    completed: state.completed,
    total: state.total,
  })

const isMachineRunning = (state: FramingState): boolean => state.mode === 'machine' && !state.terminalSeen

const openGate = (state: FramingState, closed: boolean): boolean => isMachineRunning(state) && !closed

const isStreamOpen = (state: FramingState, closed: boolean, hasDrainFiber: boolean): boolean =>
  openGate(state, closed) && hasDrainFiber

const tickEnabled = (state: FramingState, closed: boolean): boolean => state.headerWritten && openGate(state, closed)

const decisionOf = (decision: Result.Result<FrameRunEventDecision, never>): Option.Option<FrameRunEventDecision> =>
  Result.match(decision, {
    onFailure: () => Option.none(),
    onSuccess: (d) => Option.some(d),
  })

const stateAfter = (
  decision: Result.Result<FrameRunEventDecision, never>,
  fallback: FramingState,
): FramingState =>
  Result.match(decision, {
    onFailure: () => fallback,
    onSuccess: (d) => d.state,
  })

const framedEventOf = (decision: Option.Option<FrameRunEventDecision>): Result.Result<RunEvent, undefined> =>
  Option.match(decision, {
    onNone: () => Result.fail(undefined),
    onSome: (d) =>
      Match.value(d).pipe(
        Match.tag('EventFramed', (framed) => Result.succeed(framed.event)),
        Match.tag('EventSuppressed', () => Result.fail(undefined)),
        Match.exhaustive,
      ),
  })

export type FramedDrain = (
  framed: Stream.Stream<string, never, never>,
) => Effect.Effect<void, never, never>

export interface RunEventDrainShape {
  readonly drainFramed: FramedDrain
  readonly setProgressStreamFile: (fileName: string) => Effect.Effect<void, never, never>
}

export class RunEventDrain extends Context.Service<RunEventDrain, RunEventDrainShape>()(
  '@systemfsoftware/stryker-js/run-event-stream/RunEventDrain',
) {}

const drainOf = (
  stdio: Stdio.Stdio,
  framed: Stream.Stream<string>,
): Effect.Effect<void, never, never> =>
  Stream.run(framed, stdio.stdout({ endOnDone: true })).pipe(
    Effect.withSpan('stryker.output.drain'),
    Effect.catchCause((cause) => Effect.logError('stryker.output.drain_failed', cause)),
  )

export const RunEventDrainLive: Layer.Layer<RunEventDrain, never, Stdio.Stdio> = Layer.effect(
  RunEventDrain,
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    return RunEventDrain.of({
      drainFramed: (framed: Stream.Stream<string, never, never>) => drainOf(stdio, framed),
      setProgressStreamFile: () => Effect.void,
    })
  }),
)

export interface RunEventStream {
  readonly queue: Queue.Queue<RunEvent, Cause.Done>
  readonly runId: string
  readonly startedAt: number
  readonly isOpen: Effect.Effect<boolean, never, never>
  readonly ensureOpen: (openResolved: ResolvedModeInput) => Effect.Effect<void, never, never>
  readonly open: Effect.Effect<void, never, never>
  readonly closeAndDrain: Effect.Effect<void, never, never>
}

export interface RunEventStreamPort {
  readonly createRunEventStream: (
    resolved: ResolvedModeInput,
  ) => Effect.Effect<RunEventStream, never, Stdio.Stdio | RunEventDrain>
}

export class RunEventStreamPortTag extends Context.Service<
  RunEventStreamPortTag,
  RunEventStreamPort
>()('@systemfsoftware/stryker-js/run-event-stream/RunEventStreamPortTag') {}

export const RunEventStreamPort = RunEventStreamPortTag

const writeStderr = (
  stdio: Stdio.Stdio,
  line: string,
): Effect.Effect<void, never, never> =>
  Stream.run(Stream.succeed(`${line}\n`), stdio.stderr({ endOnDone: false })).pipe(
    Effect.ignore,
  )

export const makeRunEventStream = (
  resolved: ResolvedModeInput,
): Effect.Effect<RunEventStream, never, Stdio.Stdio | RunEventDrain> =>
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    const drain = yield* RunEventDrain
    const startedAt = yield* Clock.currentTimeMillis
    const runId = generateRunId(DateTime.makeUnsafe(startedAt))
    const queue = yield* Queue.bounded<RunEvent, Cause.Done>(RUN_EVENTS_QUEUE_BOUND)
    const stateRef = yield* Ref.make<FramingState>(initialFramingState(resolved))
    const closedRef = yield* Ref.make(false)
    let drainFiber: Fiber.Fiber<void, never> | null = null

    const adoptMode = (state: FramingState, openResolved: ResolvedModeInput): FramingState =>
      Match.value(state.headerWritten).pipe(
        Match.when(true, () => state),
        Match.when(false, () =>
          FramingState.make({
            mode: openResolved.mode,
            signal: openResolved.signal,
            headerWritten: state.headerWritten,
            terminalSeen: state.terminalSeen,
            completed: state.completed,
            total: state.total,
          })),
        Match.exhaustive,
      )

    const offerStarted = (state: FramingState): Effect.Effect<void, never, never> =>
      Queue.offer(
        queue,
        RunStarted.make({
          schemaVersion: STREAM_SCHEMA_VERSION,
          runId,
          mode: state.mode,
          signal: state.signal,
        }),
      )

    const openHeader: Effect.Effect<void, never, never> = Effect.gen(function*() {
      const previous = yield* Ref.getAndUpdate(stateRef, markWritten)
      const shouldOffer = !previous.headerWritten && previous.mode === 'machine'
      yield* Match.value(shouldOffer).pipe(
        Match.when(true, () => offerStarted(previous)),
        Match.when(false, () => Effect.void),
        Match.exhaustive,
      )
    })

    const queueStream = Stream.fromQueue(queue)

    const tickStream = Stream.tick(TICK_INTERVAL_MS).pipe(
      Stream.drop(1),
      Stream.filterEffect(() => Effect.zipWith(Ref.get(stateRef), Ref.get(closedRef), tickEnabled)),
      Stream.mapEffect(() =>
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const s = yield* Ref.get(stateRef)
          return Heartbeat.make({
            elapsedMs: now - startedAt,
            completed: s.completed,
            total: s.total,
          })
        })
      ),
    )

    const observed = Stream.merge(queueStream, tickStream, {
      haltStrategy: 'either',
    })

    const framed = observed.pipe(
      Stream.mapEffect((event: RunEvent) =>
        Ref.modify(stateRef, (state) => {
          const decision = frameRunEvent(FrameRunEventCommand.make({ state, event }))
          return [decisionOf(decision), stateAfter(decision, state)] as const
        })
      ),
      Stream.tap((decision) =>
        Option.match(decision, {
          onNone: () => Effect.void,
          onSome: (d) =>
            Option.match(Option.fromNullishOr(d.stderrLine), {
              onNone: () => Effect.void,
              onSome: (line) => writeStderr(stdio, line),
            }),
        })
      ),
      Stream.filterMap(framedEventOf),
      Stream.mapEffect((event: RunEvent) => S.encodeEffect(RunEventWireLine)(event).pipe(Effect.orDie)),
    )

    return {
      queue,
      runId,
      startedAt,
      isOpen: Effect.zipWith(
        Ref.get(stateRef),
        Ref.get(closedRef),
        (s, closed) => isStreamOpen(s, closed, drainFiber !== null),
      ),
      ensureOpen: (openResolved: ResolvedModeInput) => Ref.update(stateRef, (s) => adoptMode(s, openResolved)),
      open: Effect.gen(function*() {
        if (drainFiber === null) {
          drainFiber = yield* drain.drainFramed(framed).pipe(Effect.forkDetach)
        }
        yield* openHeader
      }),
      closeAndDrain: Effect.gen(function*() {
        yield* Ref.set(closedRef, true)
        yield* Queue.end(queue)
        if (drainFiber !== null) {
          yield* Fiber.join(drainFiber)
        }
      }),
    }
  })

export const RunEventStreamLive: Layer.Layer<RunEventStreamPortTag, never, never> = Layer.succeed(
  RunEventStreamPort,
  RunEventStreamPort.of({
    createRunEventStream: (resolved) => makeRunEventStream(resolved),
  }),
)
