import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { spawnReporterWorker } from '@systemfsoftware/stryker-js'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  StrykerOptionsSchema,
  TraceContextReference,
  Traceparent,
  TraceparentHeader,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { TraceContextPartsFromEffectSpan } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
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

const telemetryFor = () => {
  const exporter = new InMemorySpanExporter()
  const telemetry = NodeSdk.layer(() => ({
    resource: { serviceName: 'trace-test' },
    spanProcessor: new SimpleSpanProcessor(exporter),
  }))
  return { exporter, telemetry }
}

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
    const options = yield* S.decodeEffect(StrykerOptionsSchema)({})
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
    Effect.filterOrElse(
      (headers): headers is Headers.Headers => headers !== undefined,
      () => Effect.die(new Error('the worker never received the boundary call')),
    ),
  )

const runTracedCall = (plan: TraceWorkerPlan): Effect.Effect<TracedCall> => {
  const { exporter, telemetry } = telemetryFor()
  return Effect.scoped(
    Effect.gen(function*() {
      const { record, client } = yield* makeClient(plan)
      const host = yield* Effect.useSpan('host.run', {}, (host) =>
        Effect.as(
          client.init({}).pipe(
            Effect.provideService(TraceContextReference, S.decodeUnknownOption(TraceContextPartsFromEffectSpan)(host)),
          ),
          host,
        ))
      return {
        hostTraceId: host.traceId,
        hostSpanId: host.spanId,
        headers: yield* readHeaders(record),
        spans: exporter.getFinishedSpans(),
      }
    }),
  ).pipe(Effect.provide(telemetry), Effect.orDie)
}

const runCarriedCall = (plan: TraceWorkerPlan): Effect.Effect<TracedCall> => {
  const { exporter, telemetry } = telemetryFor()
  return Effect.scoped(
    Effect.gen(function*() {
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
  ).pipe(Effect.provide(telemetry), Effect.orDie)
}

Feature('Linking a worker into the host run trace')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
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
