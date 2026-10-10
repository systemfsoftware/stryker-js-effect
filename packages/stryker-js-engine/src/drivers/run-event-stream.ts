import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Run } from '@systemfsoftware/stryker-js-contracts'
import { Reports } from '@systemfsoftware/stryker-js-contracts'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
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
import { defaultOptions } from '../config/default-options.js'
import {
  frameRunEvent,
  FrameRunEventCommand,
  type FrameRunEventDecision,
  FramingState,
} from '../frame-run-event.workflow.js'
import { errorEnvelopeFromOutcome } from '../reporting/run-failure.js'
import { buildVerdictEnvelope, generateRunId } from '../reporting/verdict-envelope.js'

export const TICK_INTERVAL_MS = 10_000

export const initialFramingState = (resolved: Run.ResolvedModeInput) =>
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

const writeStderr = (stdio: Stdio.Stdio, line: string) =>
  Stream.run(Stream.succeed(`${line}\n`), stdio.stderr({ endOnDone: false })).pipe(Effect.ignore)

type Framework = Run.EngineIdentityShape['framework']

const emitNullScoreVerdict = <Config = unknown>(
  framework: Framework,
  params: Run.EmitNullScoreVerdictOptions<Config>,
): Effect.Effect<void> => {
  const { stream, mode, thresholds, basePath, pathService } = params
  const report: Report.MutationTestResult = {
    schemaVersion: Report.WrittenSchemaVersion.literal,
    files: {},
    thresholds,
    projectRoot: basePath,
    framework: { name: framework.name, version: framework.version },
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
  stream: Run.RunEventStream,
  failed: Run.FailedRunOutcome,
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

const offerRefusedEnvelope = (stream: Run.RunEventStream, refused: Run.RunRefused): Effect.Effect<void> =>
  Queue.offer(
    stream.queue,
    RunEvent.Refused.make({
      schemaVersion: RunEvent.StreamSchemaVersion.literal,
      rule: refused.rule,
      message: refused.message,
    }),
  )

const emitHelpEnvelope = (stream: Run.RunEventStream, help: string): Effect.Effect<void> =>
  Queue.offer(
    stream.queue,
    RunEvent.HelpRendered.make({
      schemaVersion: RunEvent.StreamSchemaVersion.literal,
      code: 0,
      help,
    }),
  )

const helpPayload = (ok: Run.RunOk, captured: string): Option.Option<string> =>
  Boolean.match(ok.help || captured.length > 0, {
    onTrue: () => Option.some(captured),
    onFalse: () => Option.none<string>(),
  })

const emitNullScoreVerdictFromDefaults = Effect.fn(SpanTaxonomy.Spans.runEventStreamNullScoreVerdict.name)(function*(
  framework: Framework,
  stream: Run.RunEventStream,
  mode: Run.ResolvedMode,
  basePath: string,
  pathService: Path.Path,
) {
  const defaults = yield* defaultOptions
  yield* emitNullScoreVerdict(framework, {
    stream,
    mode,
    thresholds: defaults.thresholds,
    config: {},
    basePath,
    pathService,
  })
})

const emitNullScoreVerdictWhenOpen = (
  framework: Framework,
  stream: Run.RunEventStream,
  mode: Run.ResolvedMode,
  basePath: string,
  pathService: Path.Path,
): Effect.Effect<void> =>
  Effect.andThen(stream.isOpen, (open) =>
    Boolean.match(open, {
      onTrue: () => emitNullScoreVerdictFromDefaults(framework, stream, mode, basePath, pathService),
      onFalse: () => Effect.void,
    }))

const emitMachineModeOutput = Effect.fn(SpanTaxonomy.Spans.runEventStreamEmitMachineModeOutput.name)(function*(
  framework: Framework,
  params: Run.EmitMachineModeOutputOptions,
) {
  const { stream, mode, outcome, basePath, pathService } = params
  const captured = (yield* Reports.MachineConsole).read()
  return yield* Result.match(outcome, {
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('RunOk', (ok): Effect.Effect<void> =>
          Option.match(helpPayload(ok, captured), {
            onSome: (help) => emitHelpEnvelope(stream, help),
            onNone: () =>
              emitNullScoreVerdictWhenOpen(
                framework,
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

const adoptMode = (state: FramingState, openResolved: Run.ResolvedModeInput) =>
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
  function*(resolved: Run.ResolvedModeInput) {
    const stdio = yield* Stdio.Stdio
    const drain = yield* Run.RunEventDrain
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
      ensureOpen: (openResolved: Run.ResolvedModeInput) => Ref.update(stateRef, (s) => adoptMode(s, openResolved)),
      open: openStream(),
      closeAndDrain: closeAndDrainStream(),
    }
  },
)

export const drainLayer: Layer.Layer<Run.RunEventDrain, never, Stdio.Stdio> = Layer.effect(
  Run.RunEventDrain,
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    return Run.RunEventDrain.of({
      drainFramed: (framed, toStdout) => drainOf(stdio, framed, toStdout),
      setProgressStreamFile: () => Effect.void,
    })
  }),
)

export const fileDrainLayer: Layer.Layer<
  Run.RunEventDrain,
  never,
  Stdio.Stdio | FileSystem.FileSystem | Path.Path
> = Layer.effect(
  Run.RunEventDrain,
  Effect.flatMap(
    Effect.all([Stdio.Stdio, FileSystem.FileSystem, Path.Path]),
    ([stdio, fs, path]) => drainFileOf(stdio, fs, path),
  ),
)

export const portLayer: Layer.Layer<Run.RunEventStreamPortTag, never, Run.EngineIdentity> = Layer.effect(
  Run.RunEventStreamPortTag,
  Effect.gen(function*() {
    const { framework } = yield* Run.EngineIdentity
    return Run.RunEventStreamPortTag.of({
      createRunEventStream: (resolved) => makeRunEventStream(resolved),
      emitNullScoreVerdict: (params) => emitNullScoreVerdict(framework, params),
      emitMachineModeOutput: (params) => emitMachineModeOutput(framework, params),
    })
  }),
)

const encodeUtf8 = (line: string) => new TextEncoder().encode(line)

const runToSink = <E>(stdio: Stdio.Stdio, lines: Stream.Stream<string, E>, toStdout: boolean) =>
  Boolean.match(toStdout, {
    onTrue: () => Stream.run(lines, stdio.stdout({ endOnDone: true })),
    onFalse: () => Stream.runDrain(lines),
  })

const drainToSinks = Effect.fn(SpanTaxonomy.Spans.runEventStreamDrainToSinks.name)(function*(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  stdio: Stdio.Stdio,
  fileName: string,
  toStdout: boolean,
  framed: Stream.Stream<string>,
) {
  yield* fs.makeDirectory(path.dirname(fileName), { recursive: true })
  yield* Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* fs.open(fileName, { flag: 'w' })
      const withFile = framed.pipe(
        Stream.tap((line) => handle.writeAll(encodeUtf8(line)).pipe(Effect.flatMap(() => handle.sync))),
      )
      yield* runToSink(stdio, withFile, toStdout).pipe(Effect.ignore)
    }),
  )
})

const drainStoredFile = Effect.fn(SpanTaxonomy.Spans.runEventStreamDrainStoredFile.name)(function*(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  stdio: Stdio.Stdio,
  fileNameRef: Ref.Ref<string>,
  toStdout: boolean,
  framed: Stream.Stream<string>,
) {
  const fileName = yield* Ref.get(fileNameRef)
  yield* drainToSinks(fs, path, stdio, fileName, toStdout, framed).pipe(Effect.orDie)
})

const drainFileOf = Effect.fn(SpanTaxonomy.Spans.runEventStreamDrainFile.name)(function*(
  stdio: Stdio.Stdio,
  fs: FileSystem.FileSystem,
  path: Path.Path,
) {
  const fileNameRef = yield* Ref.make(Run.RunEventDrain.DefaultProgressStreamFile)
  return Run.RunEventDrain.of({
    drainFramed: (framed, toStdout) =>
      drainStoredFile(fs, path, stdio, fileNameRef, toStdout, framed).pipe(
        Effect.tapCause((cause) => Effect.logError('stryker.output.drain_file_failed', cause)),
        Effect.ignoreCause,
      ),
    setProgressStreamFile: (fileName: string) => Ref.set(fileNameRef, fileName),
  })
})

const drainOf = (stdio: Stdio.Stdio, framed: Stream.Stream<string>, toStdout: boolean) =>
  runToSink(stdio, framed, toStdout).pipe(
    Effect.withSpan(SpanTaxonomy.Spans.outputDrain.name),
    Effect.tapCause((cause) => Effect.logError('stryker.output.drain_failed', cause)),
    Effect.ignoreCause,
  )
