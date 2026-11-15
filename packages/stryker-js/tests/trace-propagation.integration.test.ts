import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Plugin } from '@systemfsoftware/stryker-js'
import { Options, Trace } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace as RuntimeTrace } from '@systemfsoftware/stryker-js-plugin-runtime'
import { Contract, Graph, Observation, ObservationWindow, Rel, Stimulus } from '@systemfsoftware/trace-spec'
import { Span, Taxonomy } from '@systemfsoftware/trace-taxonomy'
import * as Effect from 'effect/Effect'
import * as Headers from 'effect/http/Headers'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'

import { HostRun, LinkedWork, RpcInit } from './__fixtures__/declared-spans.fixture.js'
import {
  makeTraceWorkerRecord,
  TRACE_WORKER_ENTRYPOINT,
  traceServingLauncher,
} from './__fixtures__/substituted-trace-worker.fixture.js'

const Feature = makeFeature({ it })

const WorkerCalls = Taxonomy.make('worker-trace-propagation').pipe(
  Taxonomy.add(HostRun),
  Taxonomy.add(RpcInit),
  Taxonomy.add(LinkedWork),
  Taxonomy.child(HostRun, RpcInit),
)

interface TraceWorkerPlan {
  readonly entrypoint: string
  readonly projectBasePath: string
}

interface TracedCall {
  readonly hostTraceId: string
  readonly hostSpanId: string
  readonly workerTraceId: string | undefined
  readonly headers: Headers.Headers
}

const PLAN: TraceWorkerPlan = { entrypoint: TRACE_WORKER_ENTRYPOINT, projectBasePath: '/project' }

/** A trace context written by a newer version of the format: a later version number and a field this version does not know. */
const futureTraceparentOf = (traceId: string, spanId: string): string => `01-${traceId}-${spanId}-01-extra`

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

const reportInTracedPhase = Stimulus.make({
  name: 'worker.report_in_traced_phase',
  run: ({ input }: { readonly input: TraceWorkerPlan }): Effect.Effect<TracedCall> =>
    Effect.scoped(
      Effect.gen(function*() {
        const { record, client } = yield* makeClient(input)
        const host = yield* Effect.currentSpan.pipe(
          Effect.tap((span) =>
            client.init({}).pipe(
              Effect.provideService(
                Trace.TraceContextReference,
                S.decodeOption(RuntimeTrace.TraceContextPartsFromEffectSpan)(span),
              ),
            )
          ),
          Span.start(HostRun, {}),
        )
        return {
          hostTraceId: host.traceId,
          hostSpanId: host.spanId,
          workerTraceId: record.linkedWorkTrace.traceId,
          headers: yield* readHeaders(record),
        }
      }),
    ).pipe(Effect.orDie),
})

const reportCarryingNewerContext = Stimulus.make({
  name: 'worker.report_carrying_newer_trace_context',
  run: ({ input }: { readonly input: TraceWorkerPlan }): Effect.Effect<TracedCall> =>
    Effect.scoped(
      Effect.gen(function*() {
        const { record, client } = yield* makeClient(input)
        const host = yield* Effect.currentSpan.pipe(
          Effect.tap((span) =>
            client.init({}, {
              headers: { [Trace.TraceparentHeader.literal]: futureTraceparentOf(span.traceId, span.spanId) },
            })
          ),
          Span.start(HostRun, {}),
        )
        return {
          hostTraceId: host.traceId,
          hostSpanId: host.spanId,
          workerTraceId: record.linkedWorkTrace.traceId,
          headers: yield* readHeaders(record),
        }
      }),
    ).pipe(Effect.orDie),
})

const workerSpanIsChildOfHost = Rel.all(
  Rel.exists(HostRun),
  Rel.unique(RpcInit),
  Rel.child(HostRun, RpcInit),
)

const hostRunContract = Contract.of(WorkerCalls).stimulate(reportInTracedPhase).holds(
  Rel.all(workerSpanIsChildOfHost, Rel.absent(LinkedWork)),
)

const newerContextContract = Contract.of(WorkerCalls).stimulate(reportCarryingNewerContext).holds(
  workerSpanIsChildOfHost,
)

const LinkedWorkTaxonomy = Taxonomy.make('worker-linked-work').pipe(Taxonomy.add(LinkedWork))

/** The linked work is a root span of its own trace, and its one link names the host span. */
const linkedWorkIsRootLinkedToHost = (host: { readonly traceId: string; readonly spanId: string }) =>
  Rel.all(
    Rel.unique(LinkedWork),
    Rel.forall(
      LinkedWork,
      (node) =>
        node.parentSpanId === null && node.links.length === 1 &&
        node.links.every((link) => link.traceId === host.traceId && link.spanId === host.spanId),
      `expected no parent and the one link ${host.traceId}/${host.spanId}`,
    ),
  )

/** Reads the trace the linked work started, which is not the host trace, and judges it as a contract does. */
const judgedLinkedWork = (call: TracedCall) =>
  Effect.gen(function*() {
    const observation = yield* Observation.Observation
    const traceId = call.workerTraceId ?? ''
    const spans = yield* observation.collect(traceId).pipe(Effect.orDie)
    const graph = yield* Effect.fromResult(Graph.decode(traceId, spans, LinkedWorkTaxonomy)).pipe(Effect.orDie)
    const relation = linkedWorkIsRootLinkedToHost({ traceId: call.hostTraceId, spanId: call.hostSpanId })
    const contract = Contract.of(LinkedWorkTaxonomy).stimulate(reportInTracedPhase).holds(relation)
    return {
      contract,
      judgment: { run: { input: PLAN, traceId, output: call }, verdict: relation(graph), dumpPath: null },
    }
  })

const harness = Layer.mergeAll(ObservationWindow.make('trace-test').layer, NodeFileSystem.layer)

Feature('Linking a worker into the host run trace')
  .withLayer(harness)
  .live(
    'the trace observation window reads spans back from an OpenTelemetry exporter that schedules its export on a real setTimeout timer, which leaves the controlled schedule',
  )
  .body(({ scenario }) => {
    scenario(
      'A worker call carries the host trace, parents its span, and links the work it starts',
      Gherkin.Do.pipe(
        Given('a reporter worker installed in the project being reported')('plan', () => Effect.succeed(PLAN)),
        When('the host reports the run inside a traced phase')(
          'judged',
          (s) => Contract.judge(hostRunContract, s.plan),
        ),
        Then(
          'the worker span is a child of the host span in the host trace, and the work the worker starts is not parented into that trace',
        )((s, expect) => Contract.verdictCheck(hostRunContract, expect, s.judged)),
        When('the work the worker started is read from the trace it started')(
          'linked',
          (s) => judgedLinkedWork(s.judged.run.output),
        ),
        Then('that work is a root span of its own trace whose one link names the host span')((s, expect) =>
          Contract.verdictCheck(s.linked.contract, expect, s.linked.judgment)
        ),
        When('what the worker received at the boundary is read back')(
          'call',
          (s) => Effect.succeed(s.judged.run.output),
        ),
        Then(
          'the boundary call carries the host span as a trace context header',
        )((s, expect) => {
          const traceparent = Option.getOrUndefined(Headers.get(s.call.headers, Trace.TraceparentHeader.literal))
          const parts = Option.getOrUndefined(S.decodeOption(Trace.Traceparent)(traceparent ?? ''))
          return expect({
            headerDecoded: parts !== undefined,
            headerTraceId: parts?.traceId,
            headerSpanId: parts?.spanId,
          }).toEqual({
            headerDecoded: true,
            headerTraceId: s.call.hostTraceId,
            headerSpanId: s.call.hostSpanId,
          })
        }),
      ),
    )

    scenario(
      'A worker continues a trace context written by a newer version it did not create',
      Gherkin.Do.pipe(
        Given('a reporter worker installed in the project being reported')('plan', () => Effect.succeed(PLAN)),
        When('the host reports the run carrying a newer trace context version')(
          'judged',
          (s) => Contract.judge(newerContextContract, s.plan),
        ),
        Then('the worker span continues the trace that version named')((s, expect) =>
          Contract.verdictCheck(newerContextContract, expect, s.judged)
        ),
      ),
    )
  })
