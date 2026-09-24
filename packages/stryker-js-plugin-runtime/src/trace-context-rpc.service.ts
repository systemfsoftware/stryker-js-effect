import * as api from '@opentelemetry/api'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as Tracer from 'effect/Tracer'
import * as Headers from 'effect/unstable/http/Headers'
import type * as Rpc from 'effect/unstable/rpc/Rpc'
import type { Request } from 'effect/unstable/rpc/RpcMessage'
import * as RpcMiddleware from 'effect/unstable/rpc/RpcMiddleware'

import { Trace } from '@systemfsoftware/stryker-js-plugin-interface'

import { TraceContextPartsFromEffectSpan } from './trace-parts.schema.js'

const serializedTraceStateOf = (traceState: api.TraceState | undefined) =>
  Option.filter(
    Option.map(Option.fromUndefinedOr(traceState), (state) => state.serialize()),
    (serialized) => serialized.length > 0,
  )

const traceStateFieldOf = (traceState: api.TraceState | undefined) =>
  Option.match(serializedTraceStateOf(traceState), {
    onNone: () => ({}),
    onSome: (serialized) => ({ traceState: serialized }),
  })

const partsOfSpanContext = (context: api.SpanContext) =>
  Option.flatMap(
    Option.liftPredicate(context, (candidate) => api.trace.isSpanContextValid(candidate)),
    (valid) =>
      S.decodeOption(Trace.TraceContextPartsSchema)({
        version: '00',
        traceId: valid.traceId,
        spanId: valid.spanId,
        traceFlags: valid.traceFlags,
        ...traceStateFieldOf(valid.traceState),
      }),
  )

const partsOfSpan = (span: api.Span | undefined) =>
  Option.flatMap(
    Option.map(Option.fromUndefinedOr(span), (present) => present.spanContext()),
    partsOfSpanContext,
  )

const remotePartsFromHeaders = (headers: Headers.Headers) =>
  Option.map(
    Option.flatMap(Headers.get(headers, Trace.TraceparentHeader.literal), S.decodeUnknownOption(Trace.Traceparent)),
    (parts) => ({ ...parts, traceState: Option.getOrUndefined(Headers.get(headers, Trace.TracestateHeader.literal)) }),
  )

const traceHeaders = (parts: Trace.TraceContextParts) =>
  Option.match(S.encodeOption(Trace.Traceparent)(parts), {
    onNone: () => Headers.empty,
    onSome: (traceparent) =>
      Option.match(Option.fromUndefinedOr(parts.traceState), {
        onNone: () => Headers.set(Headers.empty, Trace.TraceparentHeader.literal, traceparent),
        onSome: (traceState) =>
          Headers.set(
            Headers.set(Headers.empty, Trace.TraceparentHeader.literal, traceparent),
            Trace.TracestateHeader.literal,
            traceState,
          ),
      }),
  })

const inject = <A extends Rpc.Any>(request: Request<A>, parts: Trace.TraceContextParts): Request<A> => ({
  ...request,
  headers: Headers.merge(request.headers, traceHeaders(parts)),
})

const hostParts: Effect.Effect<Option.Option<Trace.TraceContextParts>> = Effect.map(
  Effect.context<never>(),
  (context) =>
    Option.orElse(
      Context.get(context, Trace.TraceContextReference),
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

export const layerTraceContextClient = RpcMiddleware.layerClient(Trace.TraceContextMiddleware, clientMiddleware)

const externalSpanOf = (parts: Trace.TraceContextParts) =>
  Option.map(S.encodeOption(TraceContextPartsFromEffectSpan)(parts), (span) => Tracer.externalSpan(span))

const serverMiddleware: RpcMiddleware.RpcMiddleware<typeof Trace.PropagatedTrace, never, never> = (effect, options) => {
  const remote = remotePartsFromHeaders(options.headers)
  const attributes = { 'rpc.method': options.rpc._tag }
  const spanned = Option.match(Option.flatMap(remote, externalSpanOf), {
    onNone: () => Effect.useSpan(`rpc.${options.rpc._tag}`, { attributes }, () => effect),
    onSome: (parent) => Effect.useSpan(`rpc.${options.rpc._tag}`, { attributes, parent }, () => effect),
  })
  return spanned.pipe(Effect.provideService(Trace.PropagatedTrace, remote))
}

export const layerTraceContextServer = Layer.succeed(Trace.TraceContextMiddleware, serverMiddleware)

export const withLinkedSpan: {
  <A, E, R>(
    spanName: string,
    attributes: Record<string, string | number | boolean>,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R>
  <A, E, R>(
    attributes: Record<string, string | number | boolean>,
    effect: Effect.Effect<A, E, R>,
  ): (spanName: string) => Effect.Effect<A, E, R>
} = dual(
  3,
  <A, E, R>(
    spanName: string,
    attributes: Record<string, string | number | boolean>,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.flatMap(Effect.context<never>(), (context) => {
      const remote = Option.flatten(Context.getOption(context, Trace.PropagatedTrace))
      return Option.match(Option.flatMap(remote, externalSpanOf), {
        onNone: () => Effect.useSpan(spanName, { attributes }, () => effect),
        onSome: (linked) =>
          Effect.useSpan(spanName, { attributes, root: true, links: [{ span: linked, attributes: {} }] }, () => effect),
      })
    }),
)
