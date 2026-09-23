import * as api from '@opentelemetry/api'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Tracer from 'effect/Tracer'
import * as Headers from 'effect/unstable/http/Headers'
import type * as Rpc from 'effect/unstable/rpc/Rpc'
import type { Request } from 'effect/unstable/rpc/RpcMessage'
import * as RpcMiddleware from 'effect/unstable/rpc/RpcMiddleware'

import type { TraceContextParts } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  formatTraceparent,
  parseTraceparent,
  PropagatedTrace,
  TraceContextMiddleware,
  TraceContextReference,
  TRACEPARENT_HEADER,
  TRACESTATE_HEADER,
} from '@systemfsoftware/stryker-js-plugin-interface'

import { SAMPLED_FLAG, tracePartsOf } from './TraceContextRpc.js'

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

const traceHeaders = (parts: TraceContextParts) =>
  Option.match(Option.fromUndefinedOr(parts.traceState), {
    onNone: () => Headers.set(Headers.empty, TRACEPARENT_HEADER, formatTraceparent(parts)),
    onSome: (traceState) =>
      Headers.set(Headers.set(Headers.empty, TRACEPARENT_HEADER, formatTraceparent(parts)), TRACESTATE_HEADER, traceState),
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

const traceStateOption = (traceState: string | undefined): { readonly traceState?: string } =>
  Option.match(Option.fromUndefinedOr(traceState), {
    onNone: () => ({}),
    onSome: (state) => ({ traceState: state }),
  })

const externalSpanOf = (parts: TraceContextParts): Tracer.ExternalSpan =>
  Tracer.externalSpan({
    traceId: parts.traceId,
    spanId: parts.spanId,
    sampled: (parts.traceFlags & SAMPLED_FLAG) === SAMPLED_FLAG,
    ...traceStateOption(parts.traceState),
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
      return Option.match(Option.map(remote, externalSpanOf), {
        onNone: () => Effect.useSpan(spanName, { attributes }, () => effect),
        onSome: (linked) =>
          Effect.useSpan(spanName, { attributes, root: true, links: [{ span: linked, attributes: {} }] }, () => effect),
      })
    }),
)
