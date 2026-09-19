import { errorToString } from '@systemfsoftware/stryker-js-instrumenter'
import type { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import type { MetricsResult } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as reportApi from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterEvent, ReporterFactory, ReporterInit } from '@systemfsoftware/stryker-js-plugin-interface'
import { MutationTestReportReady, ReporterFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  formatTraceparent,
  type ReporterInitOptions,
  ReporterRpcs,
  TraceContextReference,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { encodeWorkerOptions, partsOfEffectSpan } from '@systemfsoftware/stryker-js-plugin-runtime'
import type * as Cause from 'effect/Cause'
import * as Config from 'effect/Config'
import * as Data from 'effect/Data'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
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

import { ConfigError } from './Config.schema.js'
import { makeWorkerClient, type WorkerBootError, type WorkerLauncher } from './WorkerLauncher.js'

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
  readonly consumer: Fiber.Fiber<void, unknown>
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

const stageAttachments = (stage: ReporterStage): readonly ReporterAttachment[] => {
  if (!carriesAttachments(stage)) {
    throw new Error('not a reporter stage constructed by attachReporterFactories')
  }
  return stage.attachments
}

export interface ReporterDrainSummary {
  readonly terminalFailed: readonly string[]
}

export interface AttachReporterInput {
  readonly name: string
  readonly factory: ReporterFactory
}

export const isTerminalReportEvent = (event: ReporterEvent): boolean => S.is(MutationTestReportReady)(event)

const availableReporters = (available: readonly string[]): string => {
  if (available.length === 0) return '(none)'
  return available.join(', ')
}

const unknownReporterMessage = (unknown: readonly string[], available: readonly string[]): string => {
  const quoted = unknown.map((name) => `"${name}"`).join(', ')
  const candidates = availableReporters(available)
  if (unknown.length > 1) {
    return `Unknown reporters ${quoted}. Available reporters: ${candidates}.`
  }
  return `Unknown reporter ${quoted}. Available reporters: ${candidates}.`
}

export const validateReporterNames = (
  configured: readonly string[],
  available: readonly string[],
): Effect.Effect<void, ConfigError> => {
  const known = HashSet.fromIterable(available.map((name) => name.toLowerCase()))
  const unknown = configured.filter((name) => !HashSet.has(known, name.toLowerCase()))
  if (unknown.length === 0) {
    return Effect.void
  }
  return Effect.fail(ConfigError.make({ message: unknownReporterMessage(unknown, available) }))
}

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

const markDetachedEffect = (ports: EmitterPorts): Effect.Effect<void> =>
  Effect.gen(function*() {
    if (ports.latch.state === 'terminal') {
      return
    }
    ports.latch.state = 'detached'
    yield* Queue.shutdown(ports.queue)
    yield* Queue.shutdown(ports.inbox)
  })

const pumpEmitter = (ports: EmitterPorts): Effect.Effect<void> =>
  Stream.fromQueue(ports.inbox).pipe(
    Stream.runForEach((event) => Effect.asVoid(Queue.offer(ports.queue, event))),
    Effect.ensuring(Effect.asVoid(Queue.end(ports.queue))),
  )

const closedIteratorResult: IteratorResult<ReporterEvent> = { done: true, value: undefined }

const declaresTerminalReport = (result: IteratorResult<ReporterEvent>): boolean => {
  if (result.done !== true) return isTerminalReportEvent(result.value)
  return false
}

const closeIterator = (
  iterator: AsyncIterator<ReporterEvent>,
  value: unknown,
): Promise<IteratorResult<ReporterEvent>> => {
  const finish: AsyncIterator<ReporterEvent>['return'] | undefined = iterator.return?.bind(iterator)
  return Match.value(finish).pipe(
    Match.when(undefined, () => Promise.resolve(closedIteratorResult)),
    Match.orElse((close) => close(value)),
  )
}

export const attachReporterFactories = (
  inputs: readonly AttachReporterInput[],
  options: StrykerOptions,
  init: ReporterInit,
): Effect.Effect<ReporterStage, never, Scope.Scope> =>
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
          const observe = (result: IteratorResult<ReporterEvent>): IteratorResult<ReporterEvent> => {
            if (declaresTerminalReport(result)) {
              latch.state = 'terminal'
            }
            return result
          }
          return {
            next: () => iterator.next().then(observe),
            return: (value) => closeIterator(iterator, value),
          }
        },
      }
      const consumer = Effect.flatten(
        Effect.try({
          try: () => input.factory(options, init)(singleUse),
          catch: (reason) => new Data.Error(`Reporter "${input.name}" factory threw: ${String(reason)}`),
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
    })).pipe(Effect.map(makeReporterStage))

export const REPORTER_EVENT_BATCH_BOUND = 128

export type ReporterWorkerClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof ReporterRpcs>, RpcClientError>

const workerStreamErrorOf = (cause: unknown): ReporterFailed =>
  ReporterFailed.make({ reporterName: 'worker', event: 'mutationTestReportReady', cause: errorToString(cause) })

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
        cause: errorToString(cause),
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
  Effect.gen(function*() {
    const optionsJson = yield* encodeWorkerOptions(params.options)
    return yield* makeWorkerClient({
      rpcs: ReporterRpcs,
      entrypoint: params.entrypoint,
      workingDirectory: params.projectBasePath,
      execArgv: [...params.execArgv],
      optionsJson,
      tempDirPrefix: params.tempDirPrefix,
    })
  })

const warnEventDropped = (attachment: ReporterAttachment): Effect.Effect<void> =>
  Effect.gen(function*() {
    if (attachment.latch.state === 'detached') {
      return
    }
    yield* Effect.logWarning(`Reporter "${attachment.name}" stream closed before an event could be delivered.`)
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
  Effect.gen(function*() {
    if (attachment.latch.state === 'detached') {
      return
    }
    yield* offerToInbox(attachment, event)
  })

export const offerReporterEvent = (
  stage: ReporterStage,
  event: ReporterEvent,
): Effect.Effect<void, never> =>
  Effect.forEach(stageAttachments(stage), (attachment) => deliverReporterEvent(attachment, event), { discard: true })

export const offerTerminalReport = (
  stage: ReporterStage,
  report: reportApi.MutationTestResult,
  metrics: MetricsResult,
): Effect.Effect<void, never> => offerReporterEvent(stage, MutationTestReportReady.make({ report, metrics }))

export const terminalDrainClass = (summary: ReporterDrainSummary): ExitClass | null => {
  if (summary.terminalFailed.length > 0) {
    return 'RuntimeError'
  }
  return null
}

type ReporterDrainOutcome =
  | { readonly kind: 'completed'; readonly name: string }
  | { readonly kind: 'detached'; readonly name: string }
  | { readonly kind: 'terminal-failed'; readonly name: string }

const settleFailedAttachment = (
  attachment: ReporterAttachment,
  cause: Cause.Cause<unknown>,
): Effect.Effect<ReporterDrainOutcome, never, never> =>
  Effect.gen(function*() {
    if (attachment.latch.state === 'terminal') {
      yield* Effect.logError(`Reporter "${attachment.name}" failed while draining the terminal report.`).pipe(
        Effect.annotateLogs('cause', cause),
      )
      const failed: ReporterDrainOutcome = { kind: 'terminal-failed', name: attachment.name }
      return failed
    }
    yield* Effect.logWarning(
      `Reporter "${attachment.name}" failed before the terminal report and was detached; exit code unchanged.`,
    ).pipe(Effect.annotateLogs('cause', cause))
    const detached: ReporterDrainOutcome = { kind: 'detached', name: attachment.name }
    return detached
  })

const settleAttachment = (attachment: ReporterAttachment): Effect.Effect<ReporterDrainOutcome, never, never> =>
  Effect.gen(function*() {
    const settled = yield* Effect.exit(Fiber.join(attachment.consumer)).pipe(
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

const failedReporterNames = (outcome: ReporterDrainOutcome): readonly string[] => {
  if (outcome.kind === 'terminal-failed') return [outcome.name]
  return []
}

export const closeReporterStage = (
  stage: ReporterStage,
): Effect.Effect<ReporterDrainSummary, never, never> =>
  Effect.gen(function*() {
    const attachments = stageAttachments(stage)
    yield* Effect.forEach(attachments, (attachment) => Queue.end(attachment.inbox), { discard: true })
    yield* Effect.forEach(attachments, (attachment) => Effect.exit(Fiber.join(attachment.emitter)), {
      discard: true,
    })
    const outcomes = yield* Effect.forEach(attachments, settleAttachment, { concurrency: 'unbounded' })
    return { terminalFailed: outcomes.flatMap((outcome) => failedReporterNames(outcome)) }
  })

const traceparentInit = (traceparent: string | undefined): ReporterInitOptions => {
  if (traceparent === undefined) return {}
  return { traceparent }
}

const tracestateInit = (tracestate: string | undefined): ReporterInitOptions => {
  if (tracestate === undefined) return {}
  return { tracestate }
}

const hasTraceFields = (init: ReporterInit): boolean => {
  if (init.traceparent !== undefined) return true
  return init.tracestate !== undefined
}

const initFromPhaseSpan = (span: PhaseSpan | undefined): ReporterInit | undefined => {
  if (span === undefined) return undefined
  const parts = partsOfEffectSpan(span)
  return {
    traceparent: formatTraceparent(parts),
    ...tracestateInit(parts.traceState),
  }
}

export interface PhaseSpan {
  readonly traceId: string
  readonly spanId: string
  readonly sampled: boolean
}

const environmentTraceInit = (): Effect.Effect<ReporterInit> =>
  Effect.gen(function*() {
    const traceparent = yield* Config.string('TRACEPARENT').pipe(Effect.option)
    const tracestate = yield* Config.string('TRACESTATE').pipe(Effect.option)
    return {
      ...traceparentInit(Option.getOrUndefined(traceparent)),
      ...tracestateInit(Option.getOrUndefined(tracestate)),
    }
  })

const initFromEnvironment = (): Effect.Effect<ReporterInit | undefined> =>
  Effect.map(environmentTraceInit(), (init) => {
    if (!hasTraceFields(init)) return undefined
    return init
  })

export const currentReporterInit = (span?: PhaseSpan): Effect.Effect<ReporterInit> =>
  Effect.gen(function*() {
    const fromEnvironment = yield* initFromEnvironment()
    const current = Option.getOrUndefined(yield* Effect.currentSpan.pipe(Effect.option))
    return [
      initFromPhaseSpan(span),
      initFromPhaseSpan(current),
      fromEnvironment,
    ].find(Predicate.isNotUndefined) ?? {}
  })

export const withPhaseSpan = <A, E, R>(
  spanName: string,
  attributes: Record<string, string | number>,
  effect: (span: PhaseSpan) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.useSpan(spanName, { attributes }, (span) =>
    effect(span).pipe(
      Effect.provideService(TraceContextReference, Option.some(partsOfEffectSpan(span))),
    ))
