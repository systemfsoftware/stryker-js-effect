import * as api from '@opentelemetry/api'
import {
  formatTraceparent,
  parseTraceparent,
  PropagatedTrace,
  TraceContextMiddleware,
  type TraceContextParts,
  TraceContextReference,
  TRACEPARENT_HEADER,
  TRACESTATE_HEADER,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Tracer from 'effect/Tracer'
import * as Headers from 'effect/unstable/http/Headers'
import type * as Rpc from 'effect/unstable/rpc/Rpc'
import type { Request } from 'effect/unstable/rpc/RpcMessage'
import * as RpcMiddleware from 'effect/unstable/rpc/RpcMiddleware'

const CURRENT_VERSION = '00'

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

const remotePartsFromHeaders = (headers: Headers.Headers): Option.Option<TraceContextParts> =>
  Option.map(
    Option.flatMap(Headers.get(headers, TRACEPARENT_HEADER), parseTraceparent),
    (parts) => ({ ...parts, traceState: Option.getOrUndefined(Headers.get(headers, TRACESTATE_HEADER)) }),
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

const SAMPLED_FLAG = 0x01

const traceStateOption = (traceState: string | undefined): { readonly traceState?: string } =>
  Option.match(Option.fromUndefinedOr(traceState), {
    onNone: () => ({}),
    onSome: (state) => ({ traceState: state }),
  })

const sampledFlagOf = (sampled: boolean): number => {
  if (sampled) return SAMPLED_FLAG
  return 0
}

const externalSpanOf = (parts: TraceContextParts): Tracer.ExternalSpan =>
  Tracer.externalSpan({
    traceId: parts.traceId,
    spanId: parts.spanId,
    sampled: (parts.traceFlags & SAMPLED_FLAG) === SAMPLED_FLAG,
    ...traceStateOption(parts.traceState),
  })

export const partsOfEffectSpan = (span: {
  readonly traceId: string
  readonly spanId: string
  readonly sampled: boolean
}): TraceContextParts => ({
  version: CURRENT_VERSION,
  traceId: span.traceId,
  spanId: span.spanId,
  traceFlags: sampledFlagOf(span.sampled),
})

const serverMiddleware: RpcMiddleware.RpcMiddleware<typeof PropagatedTrace, never, never> = (effect, options) => {
  const remote = remotePartsFromHeaders(options.headers)
  const attributes = { 'rpc.method': options.rpc._tag }
  const spanned = Option.match(Option.map(remote, externalSpanOf), {
    onNone: () => Effect.useSpan(`rpc.${options.rpc._tag}`, { attributes }, () => effect),
    onSome: (parent) => Effect.useSpan(`rpc.${options.rpc._tag}`, { attributes, parent }, () => effect),
  })
  return spanned.pipe(Effect.provideService(PropagatedTrace, remote))
}

export const layerTraceContextServer = Layer.succeed(TraceContextMiddleware, serverMiddleware)

export const withLinkedSpan = <A, E, R>(
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.context<never>(), (context) => {
    const remote = Option.flatten(Context.getOption(context, PropagatedTrace))
    return Option.match(Option.map(remote, externalSpanOf), {
      onNone: () => Effect.useSpan(spanName, { attributes }, () => effect),
      onSome: (linked) =>
        Effect.useSpan(spanName, { attributes, root: true, links: [{ span: linked, attributes: {} }] }, () => effect),
    })
  })
