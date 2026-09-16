import * as api from '@opentelemetry/api'
import type { Schema } from 'effect'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Headers from 'effect/unstable/http/Headers'
import type * as Rpc from 'effect/unstable/rpc/Rpc'
import type { Request } from 'effect/unstable/rpc/RpcMessage'
import * as RpcMiddleware from 'effect/unstable/rpc/RpcMiddleware'

import {
  formatTraceparent,
  parseTraceparent,
  type TraceContextParts,
  TraceContextReference,
  TRACEPARENT_HEADER,
  TRACESTATE_HEADER,
} from './TraceContext.js'

const TRACER_NAME = 'stryker-js-plugin-worker'
const CURRENT_VERSION = '00'

export class PropagatedTrace extends Context.Service<PropagatedTrace, Option.Option<api.SpanContext>>()(
  '@systemfsoftware/stryker-js-plugin-interface/PropagatedTrace',
) {}

export class TraceContextMiddleware extends RpcMiddleware.Service<
  TraceContextMiddleware,
  { provides: typeof PropagatedTrace }
>()('@systemfsoftware/stryker-js-plugin-interface/TraceContextMiddleware', { requiredForClient: true }) {}

export type TracedRpc<
  Tag extends string,
  Payload extends Schema.Top = Schema.Void,
  Success extends Schema.Top = Schema.Void,
  Error extends Schema.Top = Schema.Never,
> = Rpc.Rpc<
  Tag,
  Payload,
  Success,
  Error,
  typeof TraceContextMiddleware,
  RpcMiddleware.ApplyServices<typeof TraceContextMiddleware['Identifier'], never>
>

const serializedTraceState = (traceState: api.TraceState | undefined): Option.Option<string> =>
  Option.filter(
    Option.map(Option.fromUndefinedOr(traceState), (state) => state.serialize()),
    (serialized) => serialized.length > 0,
  )

const traceStateField = (traceState: api.TraceState | undefined): { readonly traceState?: string } =>
  Option.match(serializedTraceState(traceState), {
    onNone: () => ({}),
    onSome: (serialized) => ({ traceState: serialized }),
  })

export const tracePartsOf = (context: api.SpanContext): Option.Option<TraceContextParts> =>
  Option.map(
    Option.liftPredicate(context, (candidate) => api.trace.isSpanContextValid(candidate)),
    (valid) => ({
      version: CURRENT_VERSION,
      traceId: valid.traceId,
      spanId: valid.spanId,
      traceFlags: valid.traceFlags,
      ...traceStateField(valid.traceState),
    }),
  )

const partsOfSpan = (span: api.Span | undefined): Option.Option<TraceContextParts> =>
  Option.flatMap(
    Option.map(Option.fromUndefinedOr(span), (present) => present.spanContext()),
    tracePartsOf,
  )

const createdTraceState = (raw: string | undefined): { readonly traceState?: api.TraceState } =>
  Option.match(Option.fromUndefinedOr(raw), {
    onNone: () => ({}),
    onSome: (value) => ({ traceState: api.createTraceState(value) }),
  })

const spanContextOf = (parts: TraceContextParts): api.SpanContext => ({
  traceId: parts.traceId,
  spanId: parts.spanId,
  traceFlags: parts.traceFlags,
  isRemote: true,
  ...createdTraceState(parts.traceState),
})

const remoteFromHeaders = (headers: Headers.Headers): Option.Option<api.SpanContext> =>
  Option.map(
    Option.flatMap(Headers.get(headers, TRACEPARENT_HEADER), parseTraceparent),
    (parts) => spanContextOf({ ...parts, traceState: Option.getOrUndefined(Headers.get(headers, TRACESTATE_HEADER)) }),
  )

const traceHeaders = (parts: TraceContextParts): Headers.Headers => {
  const traceparent = Headers.set(Headers.empty, TRACEPARENT_HEADER, formatTraceparent(parts))
  if (parts.traceState === undefined) return traceparent
  return Headers.set(traceparent, TRACESTATE_HEADER, parts.traceState)
}

const inject = <A extends Rpc.Any>(request: Request<A>, parts: TraceContextParts): Request<A> => ({
  ...request,
  headers: Headers.merge(request.headers, traceHeaders(parts)),
})

const hostParts: Effect.Effect<Option.Option<TraceContextParts>> = Effect.map(
  Effect.context<never>(),
  (context) =>
    Option.orElse(
      Context.get(context, TraceContextReference),
      () => partsOfSpan(api.trace.getSpan(api.context.active())),
    ),
)

const clientMiddleware: RpcMiddleware.RpcMiddlewareClient<never, never, never> = (options) =>
  hostParts.pipe(
    Effect.flatMap((parts) =>
      Option.match(parts, {
        onNone: () => options.next(options.request),
        onSome: (present) => options.next(inject(options.request, present)),
      })
    ),
  )

export const layerTraceContextClient = RpcMiddleware.layerClient(TraceContextMiddleware, clientMiddleware)

const serverMiddleware: RpcMiddleware.RpcMiddleware<typeof PropagatedTrace, never, never> = (effect, options) => {
  const remote = remoteFromHeaders(options.headers)
  const parent = Option.match(remote, {
    onNone: () => api.context.active(),
    onSome: (present) => api.trace.setSpanContext(api.context.active(), present),
  })
  const span = api.trace.getTracer(TRACER_NAME).startSpan(
    `rpc.${options.rpc._tag}`,
    { attributes: { 'rpc.method': options.rpc._tag } },
    parent,
  )
  return effect.pipe(
    Effect.provideService(PropagatedTrace, remote),
    Effect.ensuring(Effect.sync(() => span.end())),
  )
}

export const layerTraceContextServer = Layer.succeed(TraceContextMiddleware, serverMiddleware)

export const withLinkedSpan = <A, E, R>(
  spanName: string,
  attributes: api.Attributes,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.context<never>().pipe(
    Effect.map((context) => Option.flatten(Context.getOption(context, PropagatedTrace))),
    Effect.flatMap((remote) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const options: api.SpanOptions = Option.match(remote, {
            onNone: (): api.SpanOptions => ({ attributes }),
            onSome: (present): api.SpanOptions => ({
              attributes,
              root: true,
              links: [{ context: present }],
            }),
          })
          return api.trace.getTracer(TRACER_NAME).startSpan(spanName, options, api.context.active())
        }),
        () => effect,
        (span) => Effect.sync(() => span.end()),
      )
    ),
  )
