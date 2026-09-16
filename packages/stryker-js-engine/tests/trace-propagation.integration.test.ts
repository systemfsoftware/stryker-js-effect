import * as api from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { spawnReporterWorker } from '@systemfsoftware/stryker-js-engine'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-language'
import {
  parseTraceparent,
  TraceContextReference,
  TRACEPARENT_HEADER,
  tracePartsOf,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as Headers from 'effect/unstable/http/Headers'
import { expect } from 'vitest'

import {
  makeTraceWorkerRecord,
  TRACE_WORKER_ENTRYPOINT,
  traceServingLauncher,
} from './__fixtures__/substituted-trace-worker.fixture.js'

const Feature = makeFeature({ it, layer })

const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
api.trace.setGlobalTracerProvider(provider)

interface TraceWorkerPlan {
  readonly entrypoint: string
  readonly projectBasePath: string
}

interface TracedCall {
  readonly hostTraceId: string
  readonly hostSpanId: string
  readonly headers: Headers.Headers
  readonly spans: readonly ReadableSpan[]
}

const PLAN: TraceWorkerPlan = { entrypoint: TRACE_WORKER_ENTRYPOINT, projectBasePath: '/project' }

const FUTURE_TRACEPARENT = '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra'

const spanNamed = (spans: readonly ReadableSpan[], name: string): ReadableSpan | undefined =>
  spans.find((span) => span.name === name)

const makeClient = (plan: TraceWorkerPlan) =>
  Effect.gen(function*() {
    const record = yield* makeTraceWorkerRecord
    const launcher = yield* traceServingLauncher(record)
    const options = yield* S.decodeUnknownEffect(StrykerOptionsSchema)({})
    const client = yield* spawnReporterWorker({
      entrypoint: plan.entrypoint,
      projectBasePath: plan.projectBasePath,
      execArgv: [],
      options,
      tempDirPrefix: 'stryker-trace-',
    }).pipe(Effect.provide(launcher))
    return { record, client }
  })

const readHeaders = (
  record: { readonly headers: Ref.Ref<Headers.Headers | undefined> },
): Effect.Effect<Headers.Headers> =>
  Ref.get(record.headers).pipe(
    Effect.flatMap((headers) => {
      if (headers === undefined) {
        return Effect.die(new Error('the worker never received the boundary call'))
      }
      return Effect.succeed(headers)
    }),
  )

const runTracedCall = (plan: TraceWorkerPlan): Effect.Effect<TracedCall> =>
  Effect.scoped(
    Effect.gen(function*() {
      yield* Effect.sync(() => exporter.reset())
      const { record, client } = yield* makeClient(plan)
      const host = api.trace.getTracer('host').startSpan('host.run')
      const hostContext = host.spanContext()
      yield* client.init({}).pipe(
        Effect.provideService(TraceContextReference, tracePartsOf(hostContext)),
      )
      yield* Effect.sync(() => host.end())
      return {
        hostTraceId: hostContext.traceId,
        hostSpanId: hostContext.spanId,
        headers: yield* readHeaders(record),
        spans: exporter.getFinishedSpans(),
      }
    }),
  ).pipe(Effect.orDie)

const runCarriedCall = (plan: TraceWorkerPlan): Effect.Effect<TracedCall> =>
  Effect.scoped(
    Effect.gen(function*() {
      yield* Effect.sync(() => exporter.reset())
      const { record, client } = yield* makeClient(plan)
      const parts = Option.getOrThrow(parseTraceparent(FUTURE_TRACEPARENT))
      yield* client.init({}, { headers: { [TRACEPARENT_HEADER]: FUTURE_TRACEPARENT } })
      return {
        hostTraceId: parts.traceId,
        hostSpanId: parts.spanId,
        headers: yield* readHeaders(record),
        spans: exporter.getFinishedSpans(),
      }
    }),
  ).pipe(Effect.orDie)

Feature('Linking a worker into the host run trace').body(({ scenario }) => {
  scenario(
    'A worker call carries the host trace, parents its span, and links the work it starts',
    Gherkin.Do.pipe(
      Given('a reporter worker installed in the project being reported')('plan', () => Effect.succeed(PLAN)),
      When('the host reports the run inside a traced phase')('call', (s) => runTracedCall(s.plan)),
      Then('the boundary call carries the host span as a trace context header')((s) => {
        const traceparent = Option.getOrUndefined(Headers.get(s.call.headers, TRACEPARENT_HEADER))
        expect(Option.isSome(parseTraceparent(traceparent ?? ''))).toBe(true)
        const parts = Option.getOrUndefined(parseTraceparent(traceparent ?? ''))
        expect(parts?.traceId).toBe(s.call.hostTraceId)
        expect(parts?.spanId).toBe(s.call.hostSpanId)
      }),
      Then('the worker span is a child of the host span')((s) => {
        const workerSpan = spanNamed(s.call.spans, 'rpc.init')
        expect(workerSpan?.spanContext().traceId).toBe(s.call.hostTraceId)
        expect(workerSpan?.parentSpanContext?.spanId).toBe(s.call.hostSpanId)
      }),
      Then('the work the worker starts is connected by a span link, not a parent')((s) => {
        const linked = spanNamed(s.call.spans, 'worker.async')
        expect(linked?.parentSpanContext).toBeUndefined()
        expect(linked?.links.map((link) => link.context.spanId)).toStrictEqual([s.call.hostSpanId])
      }),
    ),
  )

  scenario(
    'A worker continues a trace context written by a newer version it did not create',
    Gherkin.Do.pipe(
      Given('a reporter worker installed in the project being reported')('plan', () => Effect.succeed(PLAN)),
      When('the host reports the run carrying a newer trace context version')(
        'call',
        (s) => runCarriedCall(s.plan),
      ),
      Then('the worker span continues the trace that version named')((s) => {
        const workerSpan = spanNamed(s.call.spans, 'rpc.init')
        expect(workerSpan?.spanContext().traceId).toBe(s.call.hostTraceId)
        expect(workerSpan?.parentSpanContext?.spanId).toBe(s.call.hostSpanId)
      }),
    ),
  )
})
