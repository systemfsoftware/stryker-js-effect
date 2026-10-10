import * as Boolean from 'effect/Boolean'
import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'
import * as SynchronizedRef from 'effect/SynchronizedRef'

import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type {
  FailedRunOutcome,
  RunOk,
  RunOutcomeDecision,
  RunOutcomeError,
  RunRefused,
} from './classify-run-outcome.workflow.js'
import { defaultOptions } from './config/default-options.js'
import {
  frameRunEvent,
  FrameRunEventCommand,
  type FrameRunEventDecision,
  FramingState,
  type ResolvedModeInput,
} from './frame-run-event.workflow.js'
import type { ResolvedMode } from './output-mode.schema.js'
import { MachineConsole } from './reporting/machine-console.service.js'
import { errorEnvelopeFromOutcome } from './reporting/run-failure.js'
import { buildVerdictEnvelope, generateRunId } from './reporting/verdict-envelope.js'
import { StrykerPackage } from './stryker-package.schema.js'

export type { ResolvedModeInput } from './frame-run-event.workflow.js'

export const TICK_INTERVAL_MS = 10_000

export const initialFramingState = (resolved: ResolvedModeInput) =>
  FramingState.make({
    mode: resolved.mode,
    signal: resolved.signal,
    headerWritten: false,
    terminalSeen: false,
    completed: 0,
    total: null,
  })

const markWritten = (state: FramingState) =>
  FramingState.make({
    mode: state.mode,
    signal: state.signal,
    headerWritten: true,
    terminalSeen: state.terminalSeen,
    completed: state.completed,
    total: state.total,
  })

const isMachineRunning = (state: FramingState) => state.mode === 'machine' && !state.terminalSeen

const openGate = (state: FramingState, closed: boolean) => isMachineRunning(state) && !closed

const isStreamOpen = (state: FramingState, closed: boolean, hasDrainFiber: boolean) =>
  openGate(state, closed) && hasDrainFiber

const tickEnabled = (state: FramingState, closed: boolean) => state.headerWritten && openGate(state, closed)

const decisionOf = (decision: Result.Result<FrameRunEventDecision, never>) =>
  Result.match(decision, {
    onFailure: () => Option.none(),
    onSuccess: Option.some,
  })

const stateAfter = (decision: Result.Result<FrameRunEventDecision, never>, fallback: FramingState) =>
  Result.match(decision, {
    onFailure: () => fallback,
    onSuccess: (d) => d.state,
  })

const framedEventOf = (decision: Option.Option<FrameRunEventDecision>) =>
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
  toStdout: boolean,
) => Effect.Effect<void, never, never>

const DEFAULT_PROGRESS_STREAM_FILE = 'reports/mutation-stream.jsonl'

export interface RunEventDrainShape {
  readonly drainFramed: FramedDrain
  readonly setProgressStreamFile: (fileName: string) => Effect.Effect<void, never, never>
}

export class RunEventDrain extends Context.Service<RunEventDrain, RunEventDrainShape>()(
  '@systemfsoftware/stryker-js/run-event-stream.service/RunEventDrain',
) {
  static readonly DefaultProgressStreamFile = DEFAULT_PROGRESS_STREAM_FILE
}

const writeStderr = (stdio: Stdio.Stdio, line: string) =>
  Stream.run(Stream.succeed(`${line}\n`), stdio.stderr({ endOnDone: false })).pipe(Effect.ignore)

export interface RunEventStream {
  readonly queue: Queue.Queue<RunEvent.RunEvent, Cause.Done>
  readonly runId: RunEvent.RunId
  readonly startedAt: number
  readonly isOpen: Effect.Effect<boolean, never, never>
  readonly ensureOpen: (openResolved: ResolvedModeInput) => Effect.Effect<void, never, never>
  readonly open: Effect.Effect<void, never, never>
  readonly closeAndDrain: Effect.Effect<void, never, never>
}

export interface EmitNullScoreVerdictOptions<Config = unknown> {
  readonly stream: RunEventStream
  readonly mode: ResolvedMode
  readonly thresholds: RunEvent.VerdictThresholds
  readonly config: Readonly<Record<string, Config>>
  readonly basePath: string
  readonly pathService: Path.Path
}

export interface EmitMachineModeOutputOptions {
  readonly stream: RunEventStream
  readonly mode: ResolvedMode
  readonly outcome: Result.Result<RunOutcomeDecision, RunOutcomeError>
  readonly basePath: string
  readonly pathService: Path.Path
}

export const emitNullScoreVerdict = <Config = unknown>(
  params: EmitNullScoreVerdictOptions<Config>,
): Effect.Effect<void> => {
  const { stream, mode, thresholds, basePath, pathService } = params
  const report: Report.MutationTestResult = {
    schemaVersion: Report.WrittenSchemaVersion.literal,
    files: {},
    thresholds,
    projectRoot: basePath,
    framework: { name: 'StrykerJS', version: StrykerPackage.version },
  }
  return Effect.gen(function*() {
    const now = yield* Clock.currentTimeMillis
    const envelope = buildVerdictEnvelope(
      { ...report, budget: { predictedSeconds: 0, actualSeconds: (now - stream.startedAt) / 1000 } },
      mode.mode,
      mode.signal,
      stream.runId,
      basePath,
      pathService,
      Option.none(),
      null,
    )
    yield* Queue.offer(
      stream.queue,
      RunEvent.VerdictReached.make({
        schemaVersion: envelope.schemaVersion,
        runId: envelope.runId,
        mode: envelope.mode,
        signal: envelope.signal,
        score: envelope.score,
        thresholds: envelope.thresholds,
        reportFile: envelope.reportFile,
        counts: envelope.counts,
        mutants: envelope.mutants,
        scope: envelope.scope,
        mutantSetPolicy: envelope.mutantSetPolicy,
        incrementalMode: envelope.incrementalMode,
        phaseDurations: envelope.phaseDurations,
        static: envelope.static,
        budget: envelope.budget,
      }),
    )
  })
}

const offerFailureEnvelope = (
  stream: RunEventStream,
  failed: FailedRunOutcome,
  captured: string,
): Effect.Effect<void> => {
  const envelope = errorEnvelopeFromOutcome({ error: failed, captured })
  return Queue.offer(
    stream.queue,
    RunEvent.RunFailed.make({
      schemaVersion: envelope.schemaVersion,
      code: envelope.code,
      error: envelope.error,
      remediation: envelope.remediation,
      reason: null,
    }),
  )
}

const offerRefusedEnvelope = (stream: RunEventStream, refused: RunRefused): Effect.Effect<void> =>
  Queue.offer(
    stream.queue,
    RunEvent.Refused.make({
      schemaVersion: RunEvent.StreamSchemaVersion.literal,
      rule: refused.rule,
      message: refused.message,
    }),
  )

const emitHelpEnvelope = (stream: RunEventStream, help: string): Effect.Effect<void> =>
  Queue.offer(
    stream.queue,
    RunEvent.HelpRendered.make({
      schemaVersion: RunEvent.StreamSchemaVersion.literal,
      code: 0,
      help,
    }),
  )

const helpPayload = (ok: RunOk, captured: string): Option.Option<string> =>
  Boolean.match(ok.help || captured.length > 0, {
    onTrue: () => Option.some(captured),
    onFalse: () => Option.none<string>(),
  })

const emitNullScoreVerdictFromDefaults = Effect.fn(SpanTaxonomy.Spans.runEventStreamNullScoreVerdict.name)(function*(
  stream: RunEventStream,
  mode: ResolvedMode,
  basePath: string,
  pathService: Path.Path,
) {
  const defaults = yield* defaultOptions
  yield* emitNullScoreVerdict({
    stream,
    mode,
    thresholds: defaults.thresholds,
    config: {},
    basePath,
    pathService,
  })
})

const emitNullScoreVerdictWhenOpen = (
  stream: RunEventStream,
  mode: ResolvedMode,
  basePath: string,
  pathService: Path.Path,
): Effect.Effect<void> =>
  Effect.andThen(stream.isOpen, (open) =>
    Boolean.match(open, {
      onTrue: () => emitNullScoreVerdictFromDefaults(stream, mode, basePath, pathService),
      onFalse: () => Effect.void,
    }))

export const emitMachineModeOutput = Effect.fn(SpanTaxonomy.Spans.runEventStreamEmitMachineModeOutput.name)(function*(
  params: EmitMachineModeOutputOptions,
) {
  const { stream, mode, outcome, basePath, pathService } = params
  const captured = (yield* MachineConsole).read()
  return yield* Result.match(outcome, {
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('RunOk', (ok): Effect.Effect<void> =>
          Option.match(helpPayload(ok, captured), {
            onSome: (help) => emitHelpEnvelope(stream, help),
            onNone: () =>
              emitNullScoreVerdictWhenOpen(
                stream,
                mode,
                basePath,
                pathService,
              ),
          })),
        Match.tag('RunParseFailed', (failed) => offerFailureEnvelope(stream, failed, captured)),
        Match.tag('RunSurvivorsRejected', (failed) => offerFailureEnvelope(stream, failed, captured)),
        Match.tag('RunConfigFailed', (failed) => offerFailureEnvelope(stream, failed, captured)),
        Match.tag('RunRefused', (refused) => offerRefusedEnvelope(stream, refused)),
        Match.tag('RunFailed', (failed) => offerFailureEnvelope(stream, failed, captured)),
        Match.exhaustive,
      ),
    onFailure: (failure) => offerFailureEnvelope(stream, failure, captured),
  })
})

export interface RunEventStreamPort {
  readonly createRunEventStream: (
    resolved: ResolvedModeInput,
  ) => Effect.Effect<RunEventStream, never, Stdio.Stdio | RunEventDrain>
  readonly emitNullScoreVerdict: <Config = unknown>(
    params: EmitNullScoreVerdictOptions<Config>,
  ) => Effect.Effect<void>
  readonly emitMachineModeOutput: (params: EmitMachineModeOutputOptions) => Effect.Effect<void, never, MachineConsole>
}

export class RunEventStreamPortTag extends Context.Service<RunEventStreamPortTag, RunEventStreamPort>()(
  '@systemfsoftware/stryker-js/run-event-stream.service/RunEventStreamPortTag',
) {}

export const RunEventStreamPort = RunEventStreamPortTag

const adoptMode = (state: FramingState, openResolved: ResolvedModeInput) =>
  Boolean.match(state.headerWritten, {
    onTrue: () => state,
    onFalse: () =>
      FramingState.make({
        mode: openResolved.mode,
        signal: openResolved.signal,
        headerWritten: state.headerWritten,
        terminalSeen: state.terminalSeen,
        completed: state.completed,
        total: state.total,
      }),
  })

interface RunEventStreamLifecycle {
  readonly closed: boolean
  readonly drainFiber: Option.Option<Fiber.Fiber<void, never>>
}

export const makeRunEventStream = Effect.fn(SpanTaxonomy.Spans.runEventStreamMake.name)(
  function*(resolved: ResolvedModeInput) {
    const stdio = yield* Stdio.Stdio
    const drain = yield* RunEventDrain
    const startedAt = yield* Clock.currentTimeMillis
    const runId = generateRunId(DateTime.makeUnsafe(startedAt))
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const stateRef = yield* Ref.make<FramingState>(initialFramingState(resolved))
    const lifecycleRef = yield* SynchronizedRef.make<RunEventStreamLifecycle>({
      closed: false,
      drainFiber: Option.none(),
    })

    const offerStarted = (state: FramingState) =>
      Queue.offer(
        queue,
        RunEvent.RunStarted.make({
          schemaVersion: RunEvent.StreamSchemaVersion.literal,
          runId,
          mode: state.mode,
          signal: state.signal,
        }),
      )

    const openHeader = Effect.fn(SpanTaxonomy.Spans.runEventStreamOpenHeader.name)(function*() {
      const previous = yield* Ref.getAndUpdate(stateRef, markWritten)
      yield* Boolean.match(!previous.headerWritten && previous.mode === 'machine', {
        onTrue: () => offerStarted(previous),
        onFalse: () => Effect.void,
      })
    })

    const queueStream = Stream.fromQueue(queue)

    const heartbeatTick = Effect.fn(SpanTaxonomy.Spans.runEventStreamTick.name)(function*() {
      const now = yield* Clock.currentTimeMillis
      const s = yield* Ref.get(stateRef)
      return RunEvent.Heartbeat.make({
        elapsedMs: now - startedAt,
        completed: s.completed,
        total: s.total,
      })
    })

    const tickStream = Stream.tick(TICK_INTERVAL_MS).pipe(
      Stream.drop(1),
      Stream.filterEffect(() =>
        Effect.zipWith(
          Ref.get(stateRef),
          SynchronizedRef.get(lifecycleRef),
          (state, lifecycle) => tickEnabled(state, lifecycle.closed),
        )
      ),
      Stream.mapEffect(() => heartbeatTick()),
    )

    const observed = Stream.merge(queueStream, tickStream, {
      haltStrategy: 'either',
    })

    const framed = observed.pipe(
      Stream.mapEffect((event: RunEvent.RunEvent) =>
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
      Stream.mapEffect((event: RunEvent.RunEvent) =>
        S.encodeEffect(RunEvent.RunEventWireLine)(event).pipe(Effect.orDie)
      ),
    )

    const startDrain = Effect.fn(SpanTaxonomy.Spans.runEventStreamStartDrain.name)(function*() {
      const mode = (yield* Ref.get(stateRef)).mode
      const drainFiber = yield* drain.drainFramed(framed, mode === 'machine').pipe(Effect.forkDetach)
      yield* SynchronizedRef.update(lifecycleRef, (present) => ({
        ...present,
        drainFiber: Option.some(drainFiber),
      }))
    })

    const openStream = Effect.fn(SpanTaxonomy.Spans.runEventStreamOpen.name)(function*() {
      const lifecycle = yield* SynchronizedRef.get(lifecycleRef)
      yield* Option.match(lifecycle.drainFiber, {
        onNone: startDrain,
        onSome: () => Effect.void,
      })
      yield* openHeader()
    })

    const closeAndDrainStream = Effect.fn(SpanTaxonomy.Spans.runEventStreamCloseAndDrain.name)(function*() {
      yield* SynchronizedRef.update(lifecycleRef, (present) => ({ ...present, closed: true }))
      yield* Queue.end(queue)
      const lifecycle = yield* SynchronizedRef.get(lifecycleRef)
      yield* Option.match(lifecycle.drainFiber, {
        onNone: () => Effect.void,
        onSome: (drainFiber) => Fiber.join(drainFiber),
      })
    })

    return {
      queue,
      runId,
      startedAt,
      isOpen: Effect.map(
        Effect.all([Ref.get(stateRef), SynchronizedRef.get(lifecycleRef)]),
        ([state, lifecycle]) => isStreamOpen(state, lifecycle.closed, Option.isSome(lifecycle.drainFiber)),
      ),
      ensureOpen: (openResolved: ResolvedModeInput) => Ref.update(stateRef, (s) => adoptMode(s, openResolved)),
      open: openStream(),
      closeAndDrain: closeAndDrainStream(),
    }
  },
)
