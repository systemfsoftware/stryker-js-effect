import * as Boolean from 'effect/Boolean'
import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
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

import type * as schema from '@systemfsoftware/stryker-js-plugin-interface'
import type { FailedRunOutcome, RunOk, RunOutcomeDecision, RunOutcomeError } from './classify-run-outcome.workflow.js'
import { StrykerConfig } from './config/stryker-config.schema.js'
import {
  frameRunEvent,
  FrameRunEventCommand,
  type FrameRunEventDecision,
  FramingState,
  type ResolvedModeInput,
} from './frame-run-event.workflow.js'
import type { ResolvedMode } from './output-mode.schema.js'
import { MachineConsole } from './reporting/machine-console.service.js'
import { ErrorEnvelope } from './reporting/run-failure.schema.js'
import { StreamSchemaVersion } from './reporting/stream-version.schema.js'
import { RunId, VerdictEnvelope } from './reporting/verdict-envelope.schema.js'
import { RunEventWireLine } from './run-event-wire.schema.js'
import { Heartbeat, HelpRendered, RunEvent, RunFailed, RunStarted, VerdictReached } from './run-event.schema.js'
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

export type FramedDrain = (framed: Stream.Stream<string, never, never>) => Effect.Effect<void, never, never>

const DEFAULT_PROGRESS_STREAM_FILE = 'reports/mutation-stream.jsonl'

export interface RunEventDrainShape {
  readonly drainFramed: FramedDrain
  readonly setProgressStreamFile: (fileName: string) => Effect.Effect<void, never, never>
}

export class RunEventDrain extends Context.Service<RunEventDrain, RunEventDrainShape>()(
  '@systemfsoftware/stryker-js/run-event-stream.service/RunEventDrain',
) {
  static readonly layer: Layer.Layer<RunEventDrain, never, Stdio.Stdio> = Layer.effect(
    RunEventDrain,
    Effect.gen(function*() {
      const stdio = yield* Stdio.Stdio
      return RunEventDrain.of({
        drainFramed: (framed) => drainOf(stdio, framed),
        setProgressStreamFile: () => Effect.void,
      })
    }),
  )

  static readonly DefaultProgressStreamFile = DEFAULT_PROGRESS_STREAM_FILE

  static readonly fileLayer: Layer.Layer<
    RunEventDrain,
    never,
    Stdio.Stdio | FileSystem.FileSystem | Path.Path
  > = Layer.effect(
    RunEventDrain,
    Effect.flatMap(
      Effect.all([Stdio.Stdio, FileSystem.FileSystem, Path.Path]),
      ([stdio, fs, path]) => drainFileOf(stdio, fs, path),
    ),
  )
}

export const RunEventDrainLive = RunEventDrain.layer

const encodeUtf8 = (line: string) => new TextEncoder().encode(line)

const drainStdoutAndFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  stdio: Stdio.Stdio,
  fileName: string,
  framed: Stream.Stream<string>,
): Effect.Effect<void, never, never> =>
  Effect.gen(function*() {
    yield* fs.makeDirectory(path.dirname(fileName), { recursive: true })
    yield* Effect.scoped(
      Effect.gen(function*() {
        const handle = yield* fs.open(fileName, { flag: 'w' })
        const withFile = framed.pipe(
          Stream.tap((line) => handle.writeAll(encodeUtf8(line)).pipe(Effect.flatMap(() => handle.sync))),
        )
        yield* Stream.run(withFile, stdio.stdout({ endOnDone: true })).pipe(Effect.ignore)
      }),
    )
  }).pipe(Effect.orDie)

const drainFileOf = (stdio: Stdio.Stdio, fs: FileSystem.FileSystem, path: Path.Path) =>
  Effect.gen(function*() {
    const fileNameRef = yield* Ref.make(DEFAULT_PROGRESS_STREAM_FILE)
    return RunEventDrain.of({
      drainFramed: (framed) =>
        Effect.gen(function*() {
          const fileName = yield* Ref.get(fileNameRef)
          yield* drainStdoutAndFile(fs, path, stdio, fileName, framed)
        }).pipe(
          Effect.tapCause((cause) => Effect.logError('stryker.output.drain_file_failed', cause)),
          Effect.ignoreCause,
        ),
      setProgressStreamFile: (fileName: string) => Ref.set(fileNameRef, fileName),
    })
  })

const drainOf = (stdio: Stdio.Stdio, framed: Stream.Stream<string>) =>
  Stream.run(framed, stdio.stdout({ endOnDone: true })).pipe(
    Effect.withSpan('stryker.output.drain'),
    Effect.tapCause((cause) => Effect.logError('stryker.output.drain_failed', cause)),
    Effect.ignoreCause,
  )

const writeStderr = (stdio: Stdio.Stdio, line: string) =>
  Stream.run(Stream.succeed(`${line}\n`), stdio.stderr({ endOnDone: false })).pipe(Effect.ignore)

export interface RunEventStream {
  readonly queue: Queue.Queue<RunEvent, Cause.Done>
  readonly runId: string
  readonly startedAt: number
  readonly isOpen: Effect.Effect<boolean, never, never>
  readonly ensureOpen: (openResolved: ResolvedModeInput) => Effect.Effect<void, never, never>
  readonly open: Effect.Effect<void, never, never>
  readonly closeAndDrain: Effect.Effect<void, never, never>
}

export interface EmitNullScoreVerdictOptions<Config = unknown> {
  readonly stream: RunEventStream
  readonly mode: ResolvedMode
  readonly thresholds: schema.Thresholds
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

const emitNullScoreVerdict = <Config = unknown>(params: EmitNullScoreVerdictOptions<Config>): Effect.Effect<void> => {
  const { stream, mode, thresholds, basePath, pathService } = params
  const report: schema.MutationTestResult = {
    schemaVersion: '1.0',
    files: {},
    thresholds,
    projectRoot: basePath,
    framework: { name: 'StrykerJS', version: StrykerPackage.version },
  }
  const envelope = VerdictEnvelope.build(
    report,
    mode.mode,
    mode.signal,
    stream.runId,
    basePath,
    pathService,
  )
  return Queue.offer(
    stream.queue,
    VerdictReached.make({
      schemaVersion: envelope.schemaVersion,
      runId: envelope.runId,
      mode: envelope.mode,
      signal: envelope.signal,
      score: envelope.score,
      thresholds: envelope.thresholds,
      reportFile: envelope.reportFile,
      counts: envelope.counts,
      mutants: envelope.mutants,
    }),
  )
}

const offerFailureEnvelope = (
  stream: RunEventStream,
  failed: FailedRunOutcome,
  captured: string,
): Effect.Effect<void> => {
  const envelope = ErrorEnvelope.fromOutcome({ error: failed, captured })
  return Queue.offer(
    stream.queue,
    RunFailed.make({
      schemaVersion: envelope.schemaVersion,
      code: envelope.code,
      error: envelope.error,
      remediation: envelope.remediation,
    }),
  )
}

const emitHelpEnvelope = (stream: RunEventStream, help: string): Effect.Effect<void> =>
  Queue.offer(
    stream.queue,
    HelpRendered.make({
      schemaVersion: StreamSchemaVersion.literal,
      code: 0,
      help,
    }),
  )

const helpPayload = (ok: RunOk, captured: string): Option.Option<string> =>
  Option.filter(Option.some(captured), () => ok.help || captured.length > 0)

const emitNullScoreVerdictWhenOpen = (
  stream: RunEventStream,
  mode: ResolvedMode,
  basePath: string,
  pathService: Path.Path,
): Effect.Effect<void> =>
  Effect.andThen(stream.isOpen, (open) =>
    Boolean.match(open, {
      onTrue: () =>
        Effect.gen(function*() {
          const defaults = yield* StrykerConfig.defaultOptions
          yield* emitNullScoreVerdict({
            stream,
            mode,
            thresholds: defaults.thresholds,
            config: {},
            basePath,
            pathService,
          })
        }),
      onFalse: () => Effect.void,
    }))

const emitMachineModeOutput = (params: EmitMachineModeOutputOptions): Effect.Effect<void, never, MachineConsole> =>
  Effect.gen(function*() {
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
) {
  static readonly layer: Layer.Layer<RunEventStreamPortTag, never, never> = Layer.succeed(
    RunEventStreamPortTag,
    RunEventStreamPortTag.of({
      createRunEventStream: (resolved) => makeRunEventStream(resolved),
      emitNullScoreVerdict,
      emitMachineModeOutput,
    }),
  )
}

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

export const makeRunEventStream = (resolved: ResolvedModeInput) =>
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    const drain = yield* RunEventDrain
    const startedAt = yield* Clock.currentTimeMillis
    const runId = RunId.generate(DateTime.makeUnsafe(startedAt)).value
    const queue = yield* Queue.bounded<RunEvent, Cause.Done>(RunEvent.QUEUE_BOUND)
    const stateRef = yield* Ref.make<FramingState>(initialFramingState(resolved))
    const closedRef = yield* Ref.make(false)
    const drainFiberRef = yield* Ref.make(Option.none<Fiber.Fiber<void, never>>())

    const offerStarted = (state: FramingState) =>
      Queue.offer(
        queue,
        RunStarted.make({
          schemaVersion: StreamSchemaVersion.literal,
          runId,
          mode: state.mode,
          signal: state.signal,
        }),
      )

    const openHeader: Effect.Effect<void, never, never> = Effect.gen(function*() {
      const previous = yield* Ref.getAndUpdate(stateRef, markWritten)
      yield* Boolean.match(!previous.headerWritten && previous.mode === 'machine', {
        onTrue: () => offerStarted(previous),
        onFalse: () => Effect.void,
      })
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
      isOpen: Effect.map(
        Effect.all([Ref.get(stateRef), Ref.get(closedRef), Ref.get(drainFiberRef)]),
        ([state, closed, drainFiber]) => isStreamOpen(state, closed, Option.isSome(drainFiber)),
      ),
      ensureOpen: (openResolved: ResolvedModeInput) => Ref.update(stateRef, (s) => adoptMode(s, openResolved)),
      open: Effect.gen(function*() {
        yield* Option.match(yield* Ref.get(drainFiberRef), {
          onNone: () =>
            Effect.gen(function*() {
              const drainFiber = yield* drain.drainFramed(framed).pipe(Effect.forkDetach)
              yield* Ref.set(drainFiberRef, Option.some(drainFiber))
            }),
          onSome: () => Effect.void,
        })
        yield* openHeader
      }),
      closeAndDrain: Effect.gen(function*() {
        yield* Ref.set(closedRef, true)
        yield* Queue.end(queue)
        yield* Option.match(yield* Ref.get(drainFiberRef), {
          onNone: () => Effect.void,
          onSome: (drainFiber) => Fiber.join(drainFiber),
        })
      }),
    }
  })
