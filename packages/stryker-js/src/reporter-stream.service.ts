import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options, Plugin, type Report, Reporter, Trace } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace as RuntimeTrace } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Boolean from 'effect/Boolean'
import type * as Cause from 'effect/Cause'
import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import { dual } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as PubSub from 'effect/PubSub'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as SynchronizedRef from 'effect/SynchronizedRef'
import type * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'

import { ConfigError } from './ConfigError.schema.js'
import { ReporterFactoryThrew, ReporterStageForged } from './stryker-error.schema.js'
import { makeWorkerClient } from './worker-client.blueprint.js'
import type { WorkerBootError } from './Worker.schema.js'
import type { WorkerLauncher } from './WorkerLauncher.service.js'

export const REPORTER_STREAM_QUEUE_BOUND = 256

interface ReporterChannelState {
  readonly terminalSeen: boolean
  readonly terminalOffered: boolean
  readonly detached: boolean
}

interface ReporterAttachment {
  readonly name: string
  readonly channel: PubSub.PubSub<Reporter.ReporterEvent>
  readonly state: SynchronizedRef.SynchronizedRef<ReporterChannelState>
  readonly consumer: Fiber.Fiber<void, Reporter.ReporterFailed | Cause.YieldableError>
}

interface ReporterChannelPorts {
  readonly channel: PubSub.PubSub<Reporter.ReporterEvent>
  readonly state: SynchronizedRef.SynchronizedRef<ReporterChannelState>
}

const portsOf = (attachment: ReporterAttachment): ReporterChannelPorts => ({
  channel: attachment.channel,
  state: attachment.state,
})

const ReporterStageTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ReporterStage')

/**
 * An attached reporter stage, opaque at the engine boundary: the published
 * phase types carry this handle so the attachment machinery (queues, fibers,
 * the state latch) never reaches an adopter's compiler. Constructed only by
 * `attachReporterFactories`.
 */
export interface ReporterStage {
  readonly [ReporterStageTypeId]: typeof ReporterStageTypeId
}

interface ReporterStageAttachments extends ReporterStage {
  readonly attachments: readonly ReporterAttachment[]
}

const carriesAttachments = (stage: ReporterStage): stage is ReporterStageAttachments => 'attachments' in stage

const makeReporterStage = (attachments: readonly ReporterAttachment[]): ReporterStage => {
  const stage: ReporterStageAttachments = { [ReporterStageTypeId]: ReporterStageTypeId, attachments }
  return stage
}

const attachmentsOf = (stage: ReporterStage): Option.Option<readonly ReporterAttachment[]> =>
  Option.map(Option.filter(Option.some(stage), carriesAttachments), (attached) => attached.attachments)

const stageAttachments = (stage: ReporterStage): Effect.Effect<readonly ReporterAttachment[], never, never> =>
  Option.match(attachmentsOf(stage), {
    onNone: () => Effect.die(ReporterStageForged.make({})),
    onSome: Effect.succeed,
  })

export interface ReporterDrainSummary {
  readonly terminalFailed: readonly string[]
}

export interface AttachReporterInput {
  readonly name: string
  readonly factory: Reporter.ReporterFactory
}

export const isTerminalReportEvent = (event: Reporter.ReporterEvent): boolean =>
  S.is(Reporter.MutationTestReportReady)(event)

const availableReporters = (available: readonly string[]): string =>
  Boolean.match(available.length === 0, {
    onTrue: () => '(none)',
    onFalse: () => available.join(', '),
  })

const unknownReporterMessage = (unknown: readonly string[], available: readonly string[]): string => {
  const quoted = unknown.map((name) => `"${name}"`).join(', ')
  const candidates = availableReporters(available)
  return Boolean.match(unknown.length > 1, {
    onTrue: () => `Unknown reporters ${quoted}. Available reporters: ${candidates}.`,
    onFalse: () => `Unknown reporter ${quoted}. Available reporters: ${candidates}.`,
  })
}

export const validateReporterNames: {
  (available: readonly string[]): (configured: readonly string[]) => Effect.Effect<void, ConfigError>
  (configured: readonly string[], available: readonly string[]): Effect.Effect<void, ConfigError>
} = dual(2, (configured: readonly string[], available: readonly string[]): Effect.Effect<void, ConfigError> => {
  const known = HashSet.fromIterable(available.map((name) => name.toLowerCase()))
  const unknown = configured.filter((name) => !HashSet.has(known, name.toLowerCase()))
  return Boolean.match(unknown.length === 0, {
    onTrue: () => Effect.void,
    onFalse: () => Effect.fail(ConfigError.make({ message: unknownReporterMessage(unknown, available) })),
  })
})

const reporterEvents = (ports: ReporterChannelPorts): AsyncIterable<Reporter.ReporterEvent> => {
  const stream = Stream.fromPubSub(ports.channel).pipe(
    Stream.tap((event) =>
      Boolean.match(isTerminalReportEvent(event), {
        onTrue: () => SynchronizedRef.update(ports.state, (state) => ({ ...state, terminalSeen: true })),
        onFalse: () => Effect.void,
      })
    ),
    Stream.takeUntil(isTerminalReportEvent),
  )
  const iterable = Stream.toAsyncIterable(stream)
  let iterator: AsyncIterator<Reporter.ReporterEvent> | undefined
  return {
    [Symbol.asyncIterator]: () => {
      iterator ??= iterable[Symbol.asyncIterator]()
      return iterator
    },
  }
}

const detach = Effect.fn('stryker.reporterStream.detach')(function*(ports: ReporterChannelPorts) {
  yield* SynchronizedRef.update(ports.state, (state) => ({ ...state, detached: true }))
  yield* PubSub.shutdown(ports.channel)
})

const markDetachedEffect = (ports: ReporterChannelPorts): Effect.Effect<void> =>
  Effect.flatMap(
    SynchronizedRef.get(ports.state),
    (state) => Boolean.match(state.terminalSeen, { onTrue: () => Effect.void, onFalse: () => detach(ports) }),
  )

const attachOneReporter = Effect.fn('stryker.reporterStream.attach')(function*(
  input: AttachReporterInput,
  options: Options.StrykerOptions,
  init: Reporter.ReporterInit,
) {
  const channel = yield* PubSub.bounded<Reporter.ReporterEvent>(REPORTER_STREAM_QUEUE_BOUND)
  const state = yield* SynchronizedRef.make<ReporterChannelState>({
    terminalSeen: false,
    terminalOffered: false,
    detached: false,
  })
  const ports: ReporterChannelPorts = { channel, state }
  const consumer = Effect.flatten(
    Effect.try({
      try: () => input.factory(options, init)(reporterEvents(ports)),
      catch: (reason) =>
        ReporterFactoryThrew.make({
          reporterName: input.name,
          message: `Reporter "${input.name}" factory threw: ${String(reason)}`,
          cause: reason,
        }),
    }),
  ).pipe(Effect.ensuring(markDetachedEffect(ports)))
  const consumerFiber = yield* Effect.forkScoped(consumer)
  return {
    name: input.name,
    channel,
    state,
    consumer: consumerFiber,
  } satisfies ReporterAttachment
})

export const attachReporterFactories: {
  (
    options: Options.StrykerOptions,
    init: Reporter.ReporterInit,
  ): (inputs: readonly AttachReporterInput[]) => Effect.Effect<ReporterStage, never, Scope.Scope>
  (
    inputs: readonly AttachReporterInput[],
    options: Options.StrykerOptions,
    init: Reporter.ReporterInit,
  ): Effect.Effect<ReporterStage, never, Scope.Scope>
} = dual(
  3,
  (inputs: readonly AttachReporterInput[], options: Options.StrykerOptions, init: Reporter.ReporterInit) =>
    Effect.forEach(inputs, (input) => attachOneReporter(input, options, init)).pipe(Effect.map(makeReporterStage)),
)

export const REPORTER_EVENT_BATCH_BOUND = 128

export type ReporterWorkerClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof Plugin.ReporterRpcs>, RpcClientError>

const workerStreamErrorOf = <E = unknown>(cause: E): Reporter.ReporterFailed =>
  Reporter.ReporterFailed.make({
    reporterName: 'worker',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(cause), (rendered) => rendered.text), () => ''),
  })

const reporterInitPayload = (init: Reporter.ReporterInit): Plugin.ReporterInitOptions => ({
  ...traceparentInit(init.traceparent),
  ...tracestateInit(init.tracestate),
})

export const reporterWorkerFactory =
  (client: ReporterWorkerClient): Reporter.ReporterFactory => (_options, init) => (events) =>
    client.init(reporterInitPayload(init)).pipe(
      Effect.andThen(
        Stream.runForEach(
          Stream.grouped(Stream.fromAsyncIterable(events, workerStreamErrorOf), REPORTER_EVENT_BATCH_BOUND),
          (batch) => client.onEventBatch([...batch]),
        ),
      ),
      Effect.andThen(client.flush()),
      Effect.mapError((cause) =>
        Reporter.ReporterFailed.make({
          reporterName: 'worker',
          event: 'mutationTestReportReady',
          cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(cause), (rendered) => rendered.text), () => ''),
        })
      ),
    )

export interface SpawnReporterWorkerParams {
  readonly entrypoint: string
  readonly projectBasePath: string
  readonly execArgv: readonly string[]
  readonly options: Options.StrykerOptions
  readonly tempDirPrefix: string
}

export const spawnReporterWorker = (
  params: SpawnReporterWorkerParams,
): Effect.Effect<ReporterWorkerClient, WorkerBootError, Scope.Scope | WorkerLauncher> =>
  makeWorkerClient({
    rpcs: Plugin.ReporterRpcs,
    options: params.options,
    entrypoint: params.entrypoint,
    workingDirectory: params.projectBasePath,
    execArgv: [...params.execArgv],
    tempDirPrefix: params.tempDirPrefix,
  })

const warnEventDropped = (attachment: ReporterAttachment): Effect.Effect<void> =>
  Effect.flatMap(
    SynchronizedRef.get(attachment.state),
    (state) =>
      Boolean.match(state.detached, {
        onTrue: () => Effect.void,
        onFalse: () =>
          Effect.logWarning(`Reporter "${attachment.name}" stream closed before an event could be delivered.`),
      }),
  )

const REPORTER_STALL_TIMEOUT = Duration.seconds(30)

const detachStalledReporter = (attachment: ReporterAttachment): Effect.Effect<void> =>
  Effect.logWarning(
    `Reporter "${attachment.name}" did not drain its events for ${
      Duration.toSeconds(REPORTER_STALL_TIMEOUT)
    } seconds and was detached; exit code unchanged.`,
  ).pipe(Effect.andThen(() => markDetachedEffect(portsOf(attachment))))

const noteTerminalOffered = (
  attachment: ReporterAttachment,
  event: Reporter.ReporterEvent,
): Effect.Effect<void> =>
  Boolean.match(isTerminalReportEvent(event), {
    onTrue: () => SynchronizedRef.update(attachment.state, (state) => ({ ...state, terminalOffered: true })),
    onFalse: () => Effect.void,
  })

const offerToChannel = Effect.fn('stryker.reporterStream.offerToChannel')(function*(
  attachment: ReporterAttachment,
  event: Reporter.ReporterEvent,
) {
  const offered = yield* PubSub.publish(attachment.channel, event).pipe(
    Effect.timeoutOption(REPORTER_STALL_TIMEOUT),
  )
  return yield* Option.match(offered, {
    onNone: () => detachStalledReporter(attachment),
    onSome: (accepted) =>
      Match.value(accepted).pipe(
        Match.when(true, () => noteTerminalOffered(attachment, event)),
        Match.orElse(() => warnEventDropped(attachment)),
      ),
  })
})

const deliverReporterEvent = (attachment: ReporterAttachment, event: Reporter.ReporterEvent): Effect.Effect<void> =>
  Effect.flatMap(
    SynchronizedRef.get(attachment.state),
    (state) =>
      Boolean.match(state.detached, { onTrue: () => Effect.void, onFalse: () => offerToChannel(attachment, event) }),
  )

export const offerReporterEvent: {
  (event: Reporter.ReporterEvent): (stage: ReporterStage) => Effect.Effect<void, never>
  (stage: ReporterStage, event: Reporter.ReporterEvent): Effect.Effect<void, never>
} = dual(
  2,
  (stage: ReporterStage, event: Reporter.ReporterEvent): Effect.Effect<void, never> =>
    Effect.flatMap(
      stageAttachments(stage),
      (attachments) =>
        Effect.forEach(attachments, (attachment) => deliverReporterEvent(attachment, event), { discard: true }),
    ),
)

export const offerTerminalReport: {
  (
    report: Report.MutationTestResult,
    metrics: Report.MetricsResult,
  ): (stage: ReporterStage) => Effect.Effect<void, never>
  (
    stage: ReporterStage,
    report: Report.MutationTestResult,
    metrics: Report.MetricsResult,
  ): Effect.Effect<void, never>
} = dual(
  3,
  (
    stage: ReporterStage,
    report: Report.MutationTestResult,
    metrics: Report.MetricsResult,
  ): Effect.Effect<void, never> =>
    offerReporterEvent(stage, Reporter.MutationTestReportReady.make({ report, metrics })),
)

export const terminalDrainClass = (summary: ReporterDrainSummary): Plugin.ExitClass | null =>
  Boolean.match(summary.terminalFailed.length > 0, {
    onTrue: () => 'RuntimeError',
    onFalse: () => null,
  })

type ReporterDrainOutcome =
  | { readonly kind: 'completed'; readonly name: string }
  | { readonly kind: 'detached'; readonly name: string }
  | { readonly kind: 'terminal-failed'; readonly name: string }

const failedOutcome = <E = unknown>(
  attachment: ReporterAttachment,
  cause: Cause.Cause<E>,
): Effect.Effect<ReporterDrainOutcome, never, never> =>
  Effect.as(
    Effect.logError(`Reporter "${attachment.name}" failed while draining the terminal report.`).pipe(
      Effect.annotateLogs('cause', cause),
    ),
    { kind: 'terminal-failed' as const, name: attachment.name },
  )

const detachedOutcome = <E = unknown>(
  attachment: ReporterAttachment,
  cause: Cause.Cause<E>,
): Effect.Effect<ReporterDrainOutcome, never, never> =>
  Effect.as(
    Effect.logWarning(
      `Reporter "${attachment.name}" failed before the terminal report and was detached; exit code unchanged.`,
    ).pipe(Effect.annotateLogs('cause', cause)),
    { kind: 'detached' as const, name: attachment.name },
  )

const settleFailedAttachment = <E = unknown>(
  attachment: ReporterAttachment,
  cause: Cause.Cause<E>,
): Effect.Effect<ReporterDrainOutcome, never, never> =>
  Effect.flatMap(
    SynchronizedRef.get(attachment.state),
    (state) =>
      Boolean.match(state.terminalSeen, {
        onTrue: () => failedOutcome(attachment, cause),
        onFalse: () => detachedOutcome(attachment, cause),
      }),
  )

const settleAttachment = Effect.fn('stryker.reporterStream.settle')(function*(attachment: ReporterAttachment) {
  const settled = yield* attachment.consumer.pipe(
    Fiber.join,
    Effect.exit,
    Effect.timeoutOption(REPORTER_STALL_TIMEOUT),
  )
  return yield* Option.match(settled, {
    onNone: () =>
      Effect.logWarning(
        `Reporter "${attachment.name}" did not finish draining for ${
          Duration.toSeconds(REPORTER_STALL_TIMEOUT)
        } seconds and was detached; exit code unchanged.`,
      ).pipe(Effect.as<ReporterDrainOutcome>({ kind: 'detached', name: attachment.name })),
    onSome: (exit) =>
      Exit.match(exit, {
        onSuccess: () => Effect.succeed<ReporterDrainOutcome>({ kind: 'completed', name: attachment.name }),
        onFailure: (cause) => settleFailedAttachment(attachment, cause),
      }),
  })
})

const failedReporterNames = (outcome: ReporterDrainOutcome): readonly string[] =>
  Match.value(outcome).pipe(
    Match.when({ kind: 'terminal-failed' }, (failed) => [failed.name]),
    Match.orElse(() => []),
  )

const shutdownUnreportedChannel = (attachment: ReporterAttachment): Effect.Effect<void> =>
  Effect.flatMap(
    SynchronizedRef.get(attachment.state),
    (state) =>
      Boolean.match(state.terminalOffered, {
        onTrue: () => Effect.void,
        onFalse: () => PubSub.shutdown(attachment.channel),
      }),
  )

export const closeReporterStage = Effect.fn('stryker.reporterStream.closeStage')(function*(stage: ReporterStage) {
  const attachments = yield* stageAttachments(stage)
  yield* Effect.forEach(attachments, shutdownUnreportedChannel, { discard: true })
  const outcomes = yield* Effect.forEach(attachments, settleAttachment, { concurrency: 'unbounded' })
  return { terminalFailed: outcomes.flatMap((outcome) => failedReporterNames(outcome)) }
})

type TraceparentInit = { readonly traceparent?: Trace.TraceparentParts }
type TracestateInit = { readonly tracestate?: string }

const traceparentInit = (traceparent: string | undefined): TraceparentInit =>
  Option.match(
    Option.flatMap(Option.fromUndefinedOr(traceparent), S.decodeOption(Trace.Traceparent)),
    {
      onNone: () => ({}),
      onSome: (present) => ({ traceparent: present }),
    },
  )

const tracestateInit = (tracestate: string | undefined): TracestateInit =>
  Option.match(Option.fromUndefinedOr(tracestate), {
    onNone: () => ({}),
    onSome: (present) => ({ tracestate: present }),
  })

const headerTraceparentInit = (traceparent: string | undefined): { readonly traceparent?: string } =>
  Option.match(Option.fromUndefinedOr(traceparent), {
    onNone: () => ({}),
    onSome: (present) => ({ traceparent: present }),
  })

const hasTraceFields = (init: Reporter.ReporterInit): boolean =>
  Option.isSome(Option.fromUndefinedOr(init.traceparent)) ||
  Option.isSome(Option.fromUndefinedOr(init.tracestate))

const initFromParts = (parts: Trace.TraceContextParts): Option.Option<Reporter.ReporterInit> =>
  Option.map(S.encodeOption(Trace.Traceparent)(parts), (traceparent): Reporter.ReporterInit => ({
    traceparent,
    ...tracestateInit(parts.traceState),
  }))

const initFromPhaseSpan = (span: PhaseSpan | undefined): Reporter.ReporterInit | undefined =>
  Option.fromNullishOr(span).pipe(
    Option.flatMap(S.decodeOption(RuntimeTrace.TraceContextPartsFromEffectSpan)),
    Option.flatMap(initFromParts),
    Option.getOrUndefined,
  )

export interface PhaseSpan {
  readonly traceId: string
  readonly spanId: string
  readonly sampled: boolean
}

const environmentTraceInit = Effect.fn('stryker.reporterStream.environmentTraceInit')(function*() {
  const traceparent = yield* Config.String('TRACEPARENT').pipe(Effect.option)
  const tracestate = yield* Config.String('TRACESTATE').pipe(Effect.option)
  return {
    ...traceparent.pipe(Option.getOrUndefined, headerTraceparentInit),
    ...tracestate.pipe(Option.getOrUndefined, tracestateInit),
  }
})

const initFromEnvironment = (): Effect.Effect<Reporter.ReporterInit | undefined> =>
  Effect.map(
    environmentTraceInit(),
    (init) => Option.getOrUndefined(Option.filter(Option.some(init), hasTraceFields)),
  )

export const environmentParentContext: Effect.Effect<Option.Option<Trace.TraceContextParts>> = Effect.gen(
  function*() {
    const traceparent = yield* Config.String('TRACEPARENT').pipe(Effect.option)
    const tracestate = yield* Config.String('TRACESTATE').pipe(Effect.option)
    return Option.map(
      Option.flatMap(traceparent, S.decodeOption(Trace.Traceparent)),
      (parts): Trace.TraceContextParts => ({
        ...parts,
        ...Option.match(Option.flatMap(tracestate, S.decodeOption(Trace.Tracestate)), {
          onNone: () => ({}),
          onSome: (traceState) => ({ traceState }),
        }),
      }),
    )
  },
)

export const currentReporterInit = Effect.fn('stryker.reporterStream.currentReporterInit')(
  function*(span?: PhaseSpan) {
    const fromEnvironment = yield* initFromEnvironment()
    const current = Option.getOrUndefined(yield* Effect.currentSpan.pipe(Effect.option))
    return [initFromPhaseSpan(span), initFromPhaseSpan(current), fromEnvironment].find(Predicate.isNotUndefined) ?? {}
  },
)

export const withPhaseSpan: {
  <A, E, R>(
    attributes: Record<string, string | number>,
    effect: (span: PhaseSpan) => Effect.Effect<A, E, R>,
  ): (spanName: string) => Effect.Effect<A, E, R>
  <A, E, R>(
    spanName: string,
    attributes: Record<string, string | number>,
    effect: (span: PhaseSpan) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R>
} = dual(3, <A, E, R>(
  spanName: string,
  attributes: Record<string, string | number>,
  effect: (span: PhaseSpan) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.useSpan(spanName, { attributes }, (span) =>
    effect(span).pipe(
      Effect.provideService(
        Trace.TraceContextReference,
        S.decodeOption(RuntimeTrace.TraceContextPartsFromEffectSpan)(span),
      ),
    )))
