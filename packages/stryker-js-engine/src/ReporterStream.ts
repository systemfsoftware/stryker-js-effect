import * as api from '@opentelemetry/api'
import type { ExitClass } from '@systemfsoftware/stryker-js-language'
import type { MetricsResult } from '@systemfsoftware/stryker-js-language'
import type * as reportApi from '@systemfsoftware/stryker-js-language'
import type { ReporterEvent, ReporterFactory, ReporterInit } from '@systemfsoftware/stryker-js-language'
import { MutationTestReportReady } from '@systemfsoftware/stryker-js-language'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-language'
import {
  encodeWorkerOptions,
  formatTraceparent,
  type ReporterInitOptions,
  ReporterRpcs,
  TraceContextReference,
  tracePartsOf,
} from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
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

interface ReporterAttachment {
  readonly name: string
  readonly inbox: Queue.Queue<ReporterEvent, Cause.Done>
  readonly queue: Queue.Queue<ReporterEvent, Cause.Done>
  readonly state: Ref.Ref<ReporterStreamState>
  readonly emitter: Fiber.Fiber<void>
  readonly consumer: Promise<void>
}

const ReporterStageTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-engine/ReporterStage')

/**
 * An attached reporter stage, opaque at the engine boundary: the published
 * phase types carry this handle so the attachment machinery (queues, fibers,
 * refs) never reaches an adopter's compiler. Constructed only by
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
  return Effect.fail(new ConfigError({ message: unknownReporterMessage(unknown, available) }))
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
  readonly state: Ref.Ref<ReporterStreamState>
}

const markDetached = (ports: EmitterPorts): void => {
  if (Effect.runSync(Ref.get(ports.state)) !== 'terminal') {
    Effect.runSync(Ref.set(ports.state, 'detached'))
    Effect.runSync(Queue.shutdown(ports.queue))
    Effect.runSync(Queue.shutdown(ports.inbox))
  }
}

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

const closeIterator = async (
  iterator: AsyncIterator<ReporterEvent>,
  value: unknown,
): Promise<IteratorResult<ReporterEvent>> => {
  if (iterator.return === undefined) return closedIteratorResult
  return iterator.return(value)
}

export const attachReporterFactories = (
  inputs: readonly AttachReporterInput[],
  options: StrykerOptions,
  init: ReporterInit,
): Effect.Effect<ReporterStage, never, Scope.Scope> =>
  Effect.forEach(inputs, (input) =>
    Effect.gen(function*() {
      const inbox = yield* Queue.unbounded<ReporterEvent, Cause.Done>()
      const queue = yield* Queue.bounded<ReporterEvent, Cause.Done>(REPORTER_STREAM_QUEUE_BOUND)
      const state = yield* Ref.make<ReporterStreamState>('streaming')
      const events = Stream.toAsyncIterable(Stream.fromQueue(queue))
      const iterator = yield* acquireReporterIterator(events)
      const ports: EmitterPorts = { inbox, queue, state }
      const singleUse: AsyncIterable<ReporterEvent> = {
        [Symbol.asyncIterator]: () => {
          const observe = (result: IteratorResult<ReporterEvent>): IteratorResult<ReporterEvent> => {
            if (declaresTerminalReport(result)) {
              Effect.runSync(Ref.set(ports.state, 'terminal'))
            }
            return result
          }
          return {
            next: async () => observe(await iterator.next()),
            return: async (value) => closeIterator(iterator, value),
          }
        },
      }
      let consumer: Promise<void>
      try {
        consumer = input.factory(options, init)(singleUse)
      } catch (reason) {
        consumer = Promise.reject(reason)
      }
      const emitter = yield* Effect.forkScoped(pumpEmitter(ports))
      const attachment: ReporterAttachment = { name: input.name, inbox, queue, state, emitter, consumer }
      void consumer.then(
        () => markDetached(ports),
        () => markDetached(ports),
      )
      return attachment
    })).pipe(Effect.map(makeReporterStage))

export const REPORTER_EVENT_BATCH_BOUND = 128

export type ReporterWorkerClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof ReporterRpcs>, RpcClientError>

const runOnWorker = <A, E>(call: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(call)

const reporterInitPayload = (init: ReporterInit): ReporterInitOptions => ({
  ...traceparentInit(init.traceparent),
  ...tracestateInit(init.tracestate),
})

const flushFilledBatch = async (client: ReporterWorkerClient, batch: ReporterEvent[]): Promise<void> => {
  if (batch.length < REPORTER_EVENT_BATCH_BOUND) return
  await runOnWorker(client.onEventBatch(batch))
  batch.length = 0
}

const flushRemainingBatch = async (client: ReporterWorkerClient, batch: ReporterEvent[]): Promise<void> => {
  if (batch.length === 0) return
  await runOnWorker(client.onEventBatch(batch))
}

export const reporterWorkerFactory =
  (client: ReporterWorkerClient): ReporterFactory => (_options, init) => async (events) => {
    await runOnWorker(client.init(reporterInitPayload(init)))
    const batch: ReporterEvent[] = []
    for await (const event of events) {
      batch.push(event)
      await flushFilledBatch(client, batch)
    }
    await flushRemainingBatch(client, batch)
    await runOnWorker(client.flush())
  }

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
    if ((yield* Ref.get(attachment.state)) === 'detached') {
      return
    }
    yield* Effect.logWarning(`Reporter "${attachment.name}" stream closed before an event could be delivered.`)
  })

const offerToInbox = (attachment: ReporterAttachment, event: ReporterEvent): Effect.Effect<void> =>
  Effect.gen(function*() {
    const offered = yield* Queue.offer(attachment.inbox, event)
    if (!offered) {
      yield* warnEventDropped(attachment)
    }
  })

const deliverReporterEvent = (attachment: ReporterAttachment, event: ReporterEvent): Effect.Effect<void> =>
  Effect.gen(function*() {
    if ((yield* Ref.get(attachment.state)) === 'detached') {
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
): Effect.Effect<void, never> => offerReporterEvent(stage, new MutationTestReportReady({ report, metrics }))

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
  cause: Cause.Cause<never>,
): Effect.Effect<ReporterDrainOutcome, never, never> =>
  Effect.gen(function*() {
    if ((yield* Ref.get(attachment.state)) === 'terminal') {
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
    const exit = yield* Effect.exit(Effect.promise(() => attachment.consumer))
    if (Exit.isSuccess(exit)) {
      const completed: ReporterDrainOutcome = { kind: 'completed', name: attachment.name }
      return completed
    }
    return yield* settleFailedAttachment(attachment, exit.cause)
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

const ENGINE_TRACER_NAME = 'stryker-js-engine'

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

const initFromSpanContext = (context: api.SpanContext | undefined): ReporterInit | undefined => {
  if (context === undefined) return undefined
  return Option.match(tracePartsOf(context), {
    onNone: () => undefined,
    onSome: (parts) => ({
      traceparent: formatTraceparent(parts),
      ...tracestateInit(parts.traceState),
    }),
  })
}

const initFromEnvironment = (): ReporterInit | undefined => {
  const init = {
    ...traceparentInit(process.env['TRACEPARENT']),
    ...tracestateInit(process.env['TRACESTATE']),
  }
  if (!hasTraceFields(init)) return undefined
  return init
}

const providedSpanContext = (span: api.Span | undefined): api.SpanContext | undefined => {
  if (span === undefined) return undefined
  return span.spanContext()
}

const activeSpanContext = (): api.SpanContext | undefined => {
  const active = api.trace.getSpan(api.context.active())
  if (active === undefined) return undefined
  return active.spanContext()
}

export const currentReporterInit = (span?: api.Span): ReporterInit =>
  [initFromSpanContext(providedSpanContext(span)), initFromSpanContext(activeSpanContext()), initFromEnvironment()]
    .find(Predicate.isNotUndefined) ?? {}

export const withPhaseSpan = <A, E, R>(
  spanName: string,
  attributes: Record<string, string | number>,
  effect: (span: api.Span) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.flatMap(
    Effect.sync(() =>
      api.trace.getTracer(ENGINE_TRACER_NAME).startSpan(spanName, { attributes }, api.context.active())
    ),
    (span) =>
      effect(span).pipe(
        Effect.provideService(TraceContextReference, tracePartsOf(span.spanContext())),
        Effect.ensuring(Effect.sync(() => span.end())),
      ),
  )
