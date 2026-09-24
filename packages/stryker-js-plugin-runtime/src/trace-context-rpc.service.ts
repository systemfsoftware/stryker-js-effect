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

import type { TraceContextParts } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  PropagatedTrace,
  TraceContextMiddleware,
  TraceContextReference,
  Traceparent,
  TraceparentHeader,
  TracestateHeader,
} from '@systemfsoftware/stryker-js-plugin-interface'

import { TraceContextPartsFromEffectSpan, TraceContextPartsFromSpanContext } from './trace-parts.schema.js'

const partsOfSpan = (span: api.Span | undefined) =>
  Option.flatMap(
    Option.map(Option.fromUndefinedOr(span), (present) => present.spanContext()),
    S.decodeOption(TraceContextPartsFromSpanContext),
  )

const remotePartsFromHeaders = (headers: Headers.Headers) =>
  Option.map(
    Option.flatMap(Headers.get(headers, TraceparentHeader.literal), S.decodeUnknownOption(Traceparent)),
    (parts) => ({ ...parts, traceState: Option.getOrUndefined(Headers.get(headers, TracestateHeader.literal)) }),
  )

const traceHeaders = (parts: TraceContextParts) =>
  Option.match(S.encodeOption(Traceparent)(parts), {
    onNone: () => Headers.empty,
    onSome: (traceparent) =>
      Option.match(Option.fromUndefinedOr(parts.traceState), {
        onNone: () => Headers.set(Headers.empty, TraceparentHeader.literal, traceparent),
        onSome: (traceState) =>
          Headers.set(
            Headers.set(Headers.empty, TraceparentHeader.literal, traceparent),
            TracestateHeader.literal,
            traceState,
          ),
      }),
  })

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

const externalSpanOf = (parts: TraceContextParts) =>
  Option.map(S.encodeOption(TraceContextPartsFromEffectSpan)(parts), (span) => Tracer.externalSpan(span))

const serverMiddleware: RpcMiddleware.RpcMiddleware<typeof PropagatedTrace, never, never> = (effect, options) => {
  const remote = remotePartsFromHeaders(options.headers)
  const attributes = { 'rpc.method': options.rpc._tag }
  const spanned = Option.match(Option.flatMap(remote, externalSpanOf), {
    onNone: () => Effect.useSpan(`rpc.${options.rpc._tag}`, { attributes }, () => effect),
    onSome: (parent) => Effect.useSpan(`rpc.${options.rpc._tag}`, { attributes, parent }, () => effect),
  })
  return spanned.pipe(Effect.provideService(PropagatedTrace, remote))
}

export const layerTraceContextServer = Layer.succeed(TraceContextMiddleware, serverMiddleware)

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
      const remote = Option.flatten(Context.getOption(context, PropagatedTrace))
      return Option.match(Option.flatMap(remote, externalSpanOf), {
        onNone: () => Effect.useSpan(spanName, { attributes }, () => effect),
        onSome: (linked) =>
          Effect.useSpan(spanName, { attributes, root: true, links: [{ span: linked, attributes: {} }] }, () => effect),
      })
    }),
)
