import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { NodeHttpServer } from '@effect/platform-node'
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine, Plugin } from '@systemfsoftware/stryker-js'
import { FailureRecord, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Options, Trace } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace as RuntimeTrace } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Headers from 'effect/http/Headers'
import * as HttpServer from 'effect/http/HttpServer'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as Match from 'effect/Match'
import type * as NetAddress from 'effect/net/NetAddress'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import { OtlpPayload, type OtlpSpan } from './__fixtures__/otlp-spans.schema.js'
import {
  makeTraceWorkerRecord,
  TRACE_WORKER_ENTRYPOINT,
  traceServingLauncher,
} from './__fixtures__/substituted-trace-worker.fixture.js'

const Feature = makeFeature({ it })

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

const spanNamed = <Span extends { readonly name: string }>(
  spans: readonly Span[],
  name: string,
): Span | undefined => spans.find((span) => span.name === name)

const makeClient = (plan: TraceWorkerPlan) =>
  Effect.gen(function*() {
    const record = yield* makeTraceWorkerRecord
    const launcher = yield* traceServingLauncher(record)
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({})
    const client = yield* Plugin.spawnReporterWorker({
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
            Effect.provideService(
              Trace.TraceContextReference,
              S.decodeOption(RuntimeTrace.TraceContextPartsFromEffectSpan)(host),
            ),
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
      const parts = Option.getOrThrow(S.decodeOption(Trace.Traceparent)(FUTURE_TRACEPARENT))
      yield* client.init({}, { headers: { [Trace.TraceparentHeader.literal]: FUTURE_TRACEPARENT } })
      return {
        hostTraceId: parts.traceId,
        hostSpanId: parts.spanId,
        headers: yield* readHeaders(record),
        spans: exporter.getFinishedSpans(),
      }
    }),
  ).pipe(Effect.provide(telemetry), Effect.orDie)
}

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const FAILURE_RECORD_FILE = 'reports/mutation/failure.json'
const FAILING_TEST_NAME = 'rejects a wrong sum'
const CONSUMER_PACKAGE = '{ "name": "trace-failure-consumer", "type": "module", "private": true }\n'
const SOURCE_CONTENT = 'export const add = (left: number, right: number): number => left + right\n'
const CONSUMER_CONFIG = [
  'export default {',
  "  testRunner: 'vm',",
  "  testFiles: ['test/**/*.mjs'],",
  "  mutate: ['src/**/*.ts'],",
  '  reporters: [],',
  '  checkers: [],',
  '}',
  '',
].join('\n')
const TEST_CONTENT = [
  "import { expect, test } from 'vitest'",
  "import { add } from '../src/math.ts'",
  '',
  `test('${FAILING_TEST_NAME}', () => {`,
  '  expect(add(1, 1)).toBe(3)',
  '})',
  '',
].join('\n')

const arrayOf = <A>(value: readonly A[] | undefined): readonly A[] =>
  Option.getOrElse(Option.fromNullishOr(value), () => [])

const spansOfPayload = (payload: OtlpPayload): readonly OtlpSpan[] =>
  Arr.flatMap(
    arrayOf(payload.resourceSpans),
    (resource) => Arr.flatMap(arrayOf(resource.scopeSpans), (scope) => arrayOf(scope.spans)),
  )

const spansOfBody = (body: Option.Option<OtlpPayload>): readonly OtlpSpan[] =>
  Option.match(body, { onNone: () => [], onSome: spansOfPayload })

const stringAttributeOf = (span: OtlpSpan, key: string): string | undefined =>
  Option.getOrUndefined(
    Option.map(
      Arr.findFirst(span.attributes, (attribute) => attribute.key === key),
      (attribute) => attribute.value.stringValue,
    ),
  )

const failureCodeOf = (spans: readonly OtlpSpan[]): string | undefined =>
  Option.match(Option.fromNullishOr(spanNamed(spans, SpanTaxonomy.Spans.cliRun.name)), {
    onNone: () => undefined,
    onSome: (span) => stringAttributeOf(span, 'stryker.failure.code'),
  })

const hasRunSpan = (spans: readonly OtlpSpan[]): boolean =>
  spanNamed(spans, SpanTaxonomy.Spans.cliRun.name) !== undefined

const traceIdMatchesSpan = (spans: readonly OtlpSpan[], traceId: string | null): boolean =>
  Option.match(Option.fromNullishOr(spanNamed(spans, SpanTaxonomy.Spans.cliRun.name)), {
    onNone: () => false,
    onSome: (span) => traceId !== null && traceId === span.traceId,
  })

const portOfAddress = (address: NetAddress.SocketAddress): number | undefined =>
  Match.value(address).pipe(
    Match.tag('InetAddressV4', (inet) => inet.port),
    Match.tag('InetAddressV6', (inet) => inet.port),
    Match.tag('UnixPathAddress', () => undefined),
    Match.exhaustive,
  )

const endpointOf = (address: NetAddress.SocketAddress): Effect.Effect<string, never> =>
  Option.match(Option.fromNullishOr(portOfAddress(address)), {
    onNone: () => Effect.die(new Error('the OTLP collector must bind a TCP port')),
    onSome: (port) => Effect.succeed(`http://127.0.0.1:${port}`),
  })

interface SpanCollector {
  readonly endpoint: string
  readonly spans: Effect.Effect<readonly OtlpSpan[]>
}

const startSpanCollector = (): Effect.Effect<SpanCollector, never, Scope.Scope | HttpServer.HttpServer> =>
  Effect.gen(function*() {
    const server = yield* HttpServer.HttpServer
    const collected: OtlpSpan[] = []
    const handler = Effect.gen(function*() {
      const body = yield* OtlpPayload.pipe(HttpServerRequest.schemaBodyJson, Effect.option)
      collected.push(...spansOfBody(body))
      return HttpServerResponse.empty()
    })
    yield* server.serve(handler)
    const endpoint = yield* endpointOf(server.address)
    return { endpoint, spans: Effect.sync(() => [...collected]) }
  })

const writeFixture = (): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-trace-failure-' }))
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@systemfsoftware'), { recursive: true })
    yield* fs.symlink(PACKAGE_ROOT, path.join(root, 'node_modules', '@systemfsoftware', 'stryker-js'))
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.makeDirectory(path.join(root, 'test'), { recursive: true })
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    yield* fs.writeFileString(path.join(root, 'src', 'math.ts'), SOURCE_CONTENT)
    yield* fs.writeFileString(path.join(root, 'test', 'math.test.mjs'), TEST_CONTENT)
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), CONSUMER_CONFIG)
    return root
  }).pipe(Effect.orDie)

const runStrykerFrom = (
  root: string,
  endpoint: string,
  otelEnabled: boolean,
): Effect.Effect<number, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'run'], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            STRYKER_MODE: 'machine',
            NO_COLOR: '1',
            OTEL_ENABLED: String(otelEnabled),
            OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
          },
          extendEnv: true,
        }),
      )
      const drainOut = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const drainErr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      yield* Effect.all([Fiber.join(drainOut), Fiber.join(drainErr)], { discard: true })
      return Number(exitCode)
    }),
  ).pipe(Effect.orDie)

const readFailureRecord = (
  root: string,
): Effect.Effect<FailureRecord.FailureRecord, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(root, FAILURE_RECORD_FILE))
    return yield* S.decodeEffect(FailureRecord.FailureRecordFile)(text)
  }).pipe(Effect.orDie)

interface ObservedRun {
  readonly exitCode: number
  readonly record: FailureRecord.FailureRecord
  readonly spans: readonly OtlpSpan[]
}

const observeFailingRun = (
  root: string,
  otelEnabled: boolean,
): Effect.Effect<ObservedRun, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const collector = yield* startSpanCollector()
      const exitCode = yield* runStrykerFrom(root, collector.endpoint, otelEnabled)
      const record = yield* readFailureRecord(root)
      const spans = yield* collector.spans
      return { exitCode, record, spans }
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  ).pipe(Effect.orDie)

Feature('Tracing a run, the work it starts, and the failure it ends with', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live(
    'the OpenTelemetry exporter schedules its export on a real setTimeout timer, and the failing-run scenarios run the built stryker binary in a real Node process against a socket collector',
  )
  .body(({ scenario }) => {
    scenario(
      'A worker call carries the host trace, parents its span, and links the work it starts',
      Gherkin.Do.pipe(
        Given('a reporter worker installed in the project being reported')('plan', () => Effect.succeed(PLAN)),
        When('the host reports the run inside a traced phase')('call', (s) => runTracedCall(s.plan)),
        Then(
          'the boundary call carries the host span as a trace context header, the worker span is a child of the host span, and the work the worker starts is connected by a span link rather than a parent',
        )((s, expect) => {
          const traceparent = Option.getOrUndefined(Headers.get(s.call.headers, Trace.TraceparentHeader.literal))
          const parts = Option.getOrUndefined(S.decodeOption(Trace.Traceparent)(traceparent ?? ''))
          const workerSpan = spanNamed(s.call.spans, 'rpc.init')
          const linked = spanNamed(s.call.spans, 'worker.async')
          return expect({
            headerDecoded: Option.isSome(S.decodeOption(Trace.Traceparent)(traceparent ?? '')),
            headerTraceId: parts?.traceId,
            headerSpanId: parts?.spanId,
            workerTraceId: workerSpan?.spanContext().traceId,
            workerParentSpanId: workerSpan?.parentSpanContext?.spanId,
            linkedParentPresent: linked?.parentSpanContext !== undefined,
            linkedSpanIds: linked?.links.map((link) => link.context.spanId),
          }).toEqual({
            headerDecoded: true,
            headerTraceId: s.call.hostTraceId,
            headerSpanId: s.call.hostSpanId,
            workerTraceId: s.call.hostTraceId,
            workerParentSpanId: s.call.hostSpanId,
            linkedParentPresent: false,
            linkedSpanIds: [s.call.hostSpanId],
          })
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
        Then('the worker span continues the trace that version named')((s, expect) => {
          const workerSpan = spanNamed(s.call.spans, 'rpc.init')
          return expect({
            workerTraceId: workerSpan?.spanContext().traceId,
            workerParentSpanId: workerSpan?.parentSpanContext?.spanId,
          }).toEqual({ workerTraceId: s.call.hostTraceId, workerParentSpanId: s.call.hostSpanId })
        }),
      ),
    )

    scenario(
      'A failing dry run stamps the run span with the record code and writes the span trace id into the record',
      Gherkin.Do.pipe(
        Given('a project whose test suite fails')('root', () => writeFixture()),
        When('the run executes with OpenTelemetry enabled')('observed', (s) => observeFailingRun(s.root, true)),
        Then(
          'the exported run span carries the failure code and the record trace id equals the span trace id',
        )((s, expect) =>
          expect({
            exitCode: s.observed.exitCode,
            failureCode: failureCodeOf(s.observed.spans),
            traceIdMatchesExportedSpan: traceIdMatchesSpan(s.observed.spans, s.observed.record.traceId),
          }).toEqual({ exitCode: 5, failureCode: 'BaselineTestsFailed', traceIdMatchesExportedSpan: true })
        ),
      ),
    )

    scenario(
      'A failing dry run with OpenTelemetry disabled records no trace id and exports nothing',
      Gherkin.Do.pipe(
        Given('a project whose test suite fails')('root', () => writeFixture()),
        When('the run executes with OpenTelemetry disabled')('observed', (s) => observeFailingRun(s.root, false)),
        Then('the record has a null trace id and no run span was exported')((s, expect) =>
          expect({
            exitCode: s.observed.exitCode,
            failureIsBaseline: Predicate.isTagged(s.observed.record, 'BaselineTestsFailed'),
            hasRunSpan: hasRunSpan(s.observed.spans),
            recordTraceId: s.observed.record.traceId,
          }).toEqual({ exitCode: 5, failureIsBaseline: true, hasRunSpan: false, recordTraceId: null })
        ),
      ),
    )
  })
