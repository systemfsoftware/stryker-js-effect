import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import type { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import type { MetricsResult } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as reportApi from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterEvent, ReporterFactory, ReporterInit } from '@systemfsoftware/stryker-js-plugin-interface'
import { MutationTestReportReady, ReporterFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  type ReporterInitOptions,
  ReporterRpcs,
  TraceContextReference,
  Traceparent,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { TraceContextPartsFromEffectSpan } from '@systemfsoftware/stryker-js-plugin-runtime'
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
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import type * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'

import { ConfigError } from './ConfigError.schema.js'
import { ReporterFactoryThrew, ReporterStageForged } from './stryker-error.schema.js'
import { makeWorkerClient } from './worker-client.resource.js'
import type { WorkerBootError, WorkerLauncher } from './WorkerLauncher.service.js'

export const REPORTER_STREAM_QUEUE_BOUND = 256

type ReporterStreamState = 'streaming' | 'terminal' | 'detached'

interface ReporterStreamLatch {
  state: ReporterStreamState
}

interface ReporterAttachment {
  readonly name: string
  readonly inbox: Queue.Queue<ReporterEvent, Cause.Done>
  readonly queue: Queue.Queue<ReporterEvent, Cause.Done>
  readonly latch: ReporterStreamLatch
  readonly emitter: Fiber.Fiber<void>
  readonly consumer: Fiber.Fiber<void, ReporterFailed | Cause.YieldableError>
}

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
  readonly factory: ReporterFactory
}

export const isTerminalReportEvent = (event: ReporterEvent): boolean => S.is(MutationTestReportReady)(event)

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

export const acquireReporterIterator = <A>(
  events: AsyncIterable<A>,
): Effect.Effect<AsyncIterator<A>, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => events[Symbol.asyncIterator]()),
    (iterator) => Effect.promise(() => Promise.resolve(iterator.return?.()).then(() => undefined)).pipe(Effect.ignore),
  )

interface EmitterPorts {
  readonly inbox: Queue.Queue<ReporterEvent, Cause.Done>
  readonly queue: Queue.Queue<ReporterEvent, Cause.Done>
  readonly latch: ReporterStreamLatch
}

const detach = (ports: EmitterPorts): Effect.Effect<void> =>
  Effect.gen(function*() {
    ports.latch.state = 'detached'
    yield* Queue.shutdown(ports.queue)
    yield* Queue.shutdown(ports.inbox)
  })

const markDetachedEffect = (ports: EmitterPorts): Effect.Effect<void> =>
  Boolean.match(ports.latch.state === 'terminal', {
    onTrue: () => Effect.void,
    onFalse: () => detach(ports),
  })

const pumpEmitter = (ports: EmitterPorts): Effect.Effect<void> =>
  Stream.fromQueue(ports.inbox).pipe(
    Stream.runForEach((event) => Effect.asVoid(Queue.offer(ports.queue, event))),
    Effect.ensuring(Effect.asVoid(Queue.end(ports.queue))),
  )

const closedIteratorResult: IteratorResult<ReporterEvent> = { done: true, value: undefined }

const isYielded = (result: IteratorResult<ReporterEvent>): result is IteratorYieldResult<ReporterEvent> =>
  result.done !== true

const yieldedOf = (result: IteratorResult<ReporterEvent>): Option.Option<IteratorYieldResult<ReporterEvent>> =>
  Option.filter(Option.some(result), isYielded)

const declaresTerminalReport = (result: IteratorResult<ReporterEvent>): boolean =>
  Option.match(yieldedOf(result), {
    onNone: () => false,
    onSome: (yielded) => isTerminalReportEvent(yielded.value),
  })

const closeIterator = <V = unknown>(
  iterator: AsyncIterator<ReporterEvent>,
  value: V,
): Promise<IteratorResult<ReporterEvent>> => {
  const finish: AsyncIterator<ReporterEvent>['return'] | undefined = iterator.return?.bind(iterator)
  return Match.value(finish).pipe(
    Match.when(undefined, () => Promise.resolve(closedIteratorResult)),
    Match.orElse((close) => close(value)),
  )
}

export const attachReporterFactories: {
  (
    options: StrykerOptions,
    init: ReporterInit,
  ): (inputs: readonly AttachReporterInput[]) => Effect.Effect<ReporterStage, never, Scope.Scope>
  (
    inputs: readonly AttachReporterInput[],
    options: StrykerOptions,
    init: ReporterInit,
  ): Effect.Effect<ReporterStage, never, Scope.Scope>
} = dual(
  3,
  (inputs: readonly AttachReporterInput[], options: StrykerOptions, init: ReporterInit) =>
    Effect.forEach(inputs, (input) =>
      Effect.gen(function*() {
        const inbox = yield* Queue.bounded<ReporterEvent, Cause.Done>(REPORTER_STREAM_QUEUE_BOUND)
        const queue = yield* Queue.bounded<ReporterEvent, Cause.Done>(REPORTER_STREAM_QUEUE_BOUND)
        const latch: ReporterStreamLatch = { state: 'streaming' }
        const events = Stream.toAsyncIterable(Stream.fromQueue(queue))
        const iterator = yield* acquireReporterIterator(events)
        const ports: EmitterPorts = { inbox, queue, latch }
        const singleUse: AsyncIterable<ReporterEvent> = {
          [Symbol.asyncIterator]: () => {
            const observe = (result: IteratorResult<ReporterEvent>): IteratorResult<ReporterEvent> =>
              Boolean.match(declaresTerminalReport(result), {
                onTrue: () => {
                  latch.state = 'terminal'
                  return result
                },
                onFalse: () => result,
              })
            return {
              next: () => iterator.next().then(observe),
              return: (value) => closeIterator(iterator, value),
            }
          },
        }
        const consumer = Effect.flatten(
          Effect.try({
            try: () => input.factory(options, init)(singleUse),
            catch: (reason) =>
              ReporterFactoryThrew.make({
                reporterName: input.name,
                message: `Reporter "${input.name}" factory threw: ${String(reason)}`,
                cause: reason,
              }),
          }),
        ).pipe(Effect.ensuring(markDetachedEffect(ports)))
        const consumerFiber = yield* Effect.forkScoped(consumer)
        const emitter = yield* Effect.forkScoped(pumpEmitter(ports))
        const attachment: ReporterAttachment = {
          name: input.name,
          inbox,
          queue,
          latch,
          emitter,
          consumer: consumerFiber,
        }
        return attachment
      })).pipe(Effect.map(makeReporterStage)),
)

export const REPORTER_EVENT_BATCH_BOUND = 128

export type ReporterWorkerClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof ReporterRpcs>, RpcClientError>

const workerStreamErrorOf = <E = unknown>(cause: E): ReporterFailed =>
  ReporterFailed.make({
    reporterName: 'worker',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(Option.fromUndefinedOr(ErrorText.fromCause(cause)), (rendered) => rendered.text), () => ''),
  })

const reporterInitPayload = (init: ReporterInit): ReporterInitOptions => ({
  ...traceparentInit(init.traceparent),
  ...tracestateInit(init.tracestate),
})

export const reporterWorkerFactory = (client: ReporterWorkerClient): ReporterFactory => (_options, init) => (events) =>
  client.init(reporterInitPayload(init)).pipe(
    Effect.andThen(
      Stream.runForEach(
        Stream.grouped(Stream.fromAsyncIterable(events, workerStreamErrorOf), REPORTER_EVENT_BATCH_BOUND),
        (batch) => client.onEventBatch([...batch]),
      ),
    ),
    Effect.andThen(client.flush()),
    Effect.mapError((cause) =>
      ReporterFailed.make({
        reporterName: 'worker',
        event: 'mutationTestReportReady',
        cause: Option.getOrElse(Option.map(Option.fromUndefinedOr(ErrorText.fromCause(cause)), (rendered) => rendered.text), () => ''),
      })
    ),
  )

export interface SpawnReporterWorkerParams {
  readonly entrypoint: string
  readonly projectBasePath: string
  readonly execArgv: readonly string[]
  readonly options: StrykerOptions
  readonly tempDirPrefix: string
}

export const spawnReporterWorker = (
  params: SpawnReporterWorkerParams,
): Effect.Effect<ReporterWorkerClient, WorkerBootError, Scope.Scope | WorkerLauncher> =>
  makeWorkerClient({
    rpcs: ReporterRpcs,
    options: params.options,
    entrypoint: params.entrypoint,
    workingDirectory: params.projectBasePath,
    execArgv: [...params.execArgv],
    tempDirPrefix: params.tempDirPrefix,
  })

const warnEventDropped = (attachment: ReporterAttachment): Effect.Effect<void> =>
  Boolean.match(attachment.latch.state === 'detached', {
    onTrue: () => Effect.void,
    onFalse: () =>
      Effect.logWarning(`Reporter "${attachment.name}" stream closed before an event could be delivered.`),
  })

const REPORTER_STALL_TIMEOUT = Duration.seconds(30)

const detachStalledReporter = (attachment: ReporterAttachment): Effect.Effect<void> =>
  Effect.logWarning(
    `Reporter "${attachment.name}" did not drain its events for ${
      Duration.toSeconds(REPORTER_STALL_TIMEOUT)
    } seconds and was detached; exit code unchanged.`,
  ).pipe(
    Effect.andThen(() =>
      markDetachedEffect({ inbox: attachment.inbox, queue: attachment.queue, latch: attachment.latch })
    ),
  )

const offerToInbox = (attachment: ReporterAttachment, event: ReporterEvent): Effect.Effect<void> =>
  Effect.gen(function*() {
    const offered = yield* Queue.offer(attachment.inbox, event).pipe(Effect.timeoutOption(REPORTER_STALL_TIMEOUT))
    return yield* Option.match(offered, {
      onNone: () => detachStalledReporter(attachment),
      onSome: (accepted) =>
        Match.value(accepted).pipe(
          Match.when(true, () => Effect.void),
          Match.orElse(() => warnEventDropped(attachment)),
        ),
    })
  })

const deliverReporterEvent = (attachment: ReporterAttachment, event: ReporterEvent): Effect.Effect<void> =>
  Boolean.match(attachment.latch.state === 'detached', {
    onTrue: () => Effect.void,
    onFalse: () => offerToInbox(attachment, event),
  })

export const offerReporterEvent: {
  (event: ReporterEvent): (stage: ReporterStage) => Effect.Effect<void, never>
  (stage: ReporterStage, event: ReporterEvent): Effect.Effect<void, never>
} = dual(
  2,
  (stage: ReporterStage, event: ReporterEvent): Effect.Effect<void, never> =>
    Effect.flatMap(stageAttachments(stage), (attachments) =>
      Effect.forEach(attachments, (attachment) => deliverReporterEvent(attachment, event), { discard: true })),
)

export const offerTerminalReport: {
  (
    report: reportApi.MutationTestResult,
    metrics: MetricsResult,
  ): (stage: ReporterStage) => Effect.Effect<void, never>
  (
    stage: ReporterStage,
    report: reportApi.MutationTestResult,
    metrics: MetricsResult,
  ): Effect.Effect<void, never>
} = dual(
  3,
  (
    stage: ReporterStage,
    report: reportApi.MutationTestResult,
    metrics: MetricsResult,
  ): Effect.Effect<void, never> => offerReporterEvent(stage, MutationTestReportReady.make({ report, metrics })),
)

export const terminalDrainClass = (summary: ReporterDrainSummary): ExitClass | null =>
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
  Boolean.match(attachment.latch.state === 'terminal', {
    onTrue: () => failedOutcome(attachment, cause),
    onFalse: () => detachedOutcome(attachment, cause),
  })

const settleAttachment = (attachment: ReporterAttachment): Effect.Effect<ReporterDrainOutcome, never, never> =>
  Effect.gen(function*() {
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

export const closeReporterStage = (
  stage: ReporterStage,
): Effect.Effect<ReporterDrainSummary, never, never> =>
  Effect.flatMap(stageAttachments(stage), (attachments) =>
    Effect.gen(function*() {
      yield* Effect.forEach(attachments, (attachment) => Queue.end(attachment.inbox), { discard: true })
      yield* Effect.forEach(attachments, (attachment) => attachment.emitter.pipe(Fiber.join, Effect.exit), {
        discard: true,
      })
      const outcomes = yield* Effect.forEach(attachments, settleAttachment, { concurrency: 'unbounded' })
      return { terminalFailed: outcomes.flatMap((outcome) => failedReporterNames(outcome)) }
    }))

const traceparentInit = (traceparent: string | undefined): ReporterInitOptions =>
  Option.match(Option.fromUndefinedOr(traceparent), {
    onNone: () => ({}),
    onSome: (present) => ({ traceparent: present }),
  })

const tracestateInit = (tracestate: string | undefined): ReporterInitOptions =>
  Option.match(Option.fromUndefinedOr(tracestate), {
    onNone: () => ({}),
    onSome: (present) => ({ tracestate: present }),
  })

const hasTraceFields = (init: ReporterInit): boolean =>
  Option.isSome(Option.fromUndefinedOr(init.traceparent)) ||
  Option.isSome(Option.fromUndefinedOr(init.tracestate))

const initFromPhaseSpan = (span: PhaseSpan | undefined): Effect.Effect<ReporterInit | undefined> =>
  Option.match(Option.fromNullishOr(span), {
    onNone: () => Effect.succeed(undefined),
    onSome: (present) =>
      Option.match(S.decodeUnknownOption(TraceContextPartsFromEffectSpan)(present), {
        onNone: () => Effect.succeed(undefined),
        onSome: (parts) =>
          S.encode(Traceparent)(parts).pipe(
            Effect.orDie,
            Effect.map((traceparent): ReporterInit => ({
              traceparent,
              ...tracestateInit(parts.traceState),
            })),
          ),
      }),
  })

export interface PhaseSpan {
  readonly traceId: string
  readonly spanId: string
  readonly sampled: boolean
}

const environmentTraceInit = (): Effect.Effect<ReporterInit> =>
  Effect.gen(function*() {
    const traceparent = yield* Config.String('TRACEPARENT').pipe(Effect.option)
    const tracestate = yield* Config.String('TRACESTATE').pipe(Effect.option)
    return {
      ...traceparent.pipe(Option.getOrUndefined, traceparentInit),
      ...tracestate.pipe(Option.getOrUndefined, tracestateInit),
    }
  })

const initFromEnvironment = (): Effect.Effect<ReporterInit | undefined> =>
  Effect.map(
    environmentTraceInit(),
    (init) => Option.getOrUndefined(Option.filter(Option.some(init), hasTraceFields)),
  )

export const currentReporterInit = (span?: PhaseSpan): Effect.Effect<ReporterInit> =>
  Effect.gen(function*() {
    const fromEnvironment = yield* initFromEnvironment()
    const current = Option.getOrUndefined(yield* Effect.currentSpan.pipe(Effect.option))
    const fromSpanPhase = yield* initFromPhaseSpan(span)
    const fromSpanCurrent = yield* initFromPhaseSpan(current)
    return [fromSpanPhase, fromSpanCurrent, fromEnvironment].find(Predicate.isNotUndefined) ?? {}
  })

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
      Effect.provideService(TraceContextReference, S.decodeUnknownOption(TraceContextPartsFromEffectSpan)(span)),
    )))
