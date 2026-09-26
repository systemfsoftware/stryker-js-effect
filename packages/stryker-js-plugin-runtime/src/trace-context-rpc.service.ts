import * as api from '@opentelemetry/api'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Tracer from 'effect/Tracer'
import * as Headers from 'effect/unstable/http/Headers'
import type * as Rpc from 'effect/unstable/rpc/Rpc'
import type { Request } from 'effect/unstable/rpc/RpcMessage'
import * as RpcMiddleware from 'effect/unstable/rpc/RpcMiddleware'

import { Trace } from '@systemfsoftware/stryker-js-plugin-interface'

import { TraceContextPartsFromEffectSpan, TraceContextUnavailable } from './trace-parts.schema.js'

const serializedTraceStateOf = (traceState: api.TraceState | undefined): Option.Option<string> =>
  Option.flatMap(
    Option.fromUndefinedOr(traceState),
    (state) => Option.liftPredicate(state.serialize(), (serialized) => serialized.length > 0),
  )

const traceStateFieldOf = (traceState: api.TraceState | undefined): { readonly traceState?: string } =>
  Option.match(serializedTraceStateOf(traceState), {
    onNone: () => ({}),
    onSome: (serialized) => ({ traceState: serialized }),
  })

const partsOfSpanContext = (
  context: api.SpanContext,
): Result.Result<Trace.TraceContextParts, TraceContextUnavailable> =>
  Result.flatMap(
    Result.fromOption(
      Option.liftPredicate(context, (candidate) => api.trace.isSpanContextValid(candidate)),
      () => TraceContextUnavailable.make({ reason: 'invalid-span-context' }),
    ),
    (valid) =>
      Result.fromOption(
        S.decodeOption(Trace.TraceContextPartsSchema)({
          version: '00',
          traceId: valid.traceId,
          spanId: valid.spanId,
          traceFlags: valid.traceFlags,
          ...traceStateFieldOf(valid.traceState),
        }),
        () => TraceContextUnavailable.make({ reason: 'undecodable-parts' }),
      ),
  )

const partsOfSpan = (
  span: api.Span | undefined,
): Result.Result<Option.Option<Trace.TraceContextParts>, TraceContextUnavailable> =>
  Option.match(Option.fromUndefinedOr(span), {
    onNone: () => Result.succeed(Option.none<Trace.TraceContextParts>()),
    onSome: (present) => Result.map(partsOfSpanContext(present.spanContext()), Option.some),
  })

const remotePartsFromHeaders = (headers: Headers.Headers): Option.Option<Trace.TraceContextParts> =>
  Option.flatMap(
    Headers.get(headers, Trace.TraceparentHeader.literal),
    (traceparent) =>
      Option.map(S.decodeOption(Trace.Traceparent)(traceparent), (parts) => ({
        ...parts,
        traceState: Option.getOrUndefined(Headers.get(headers, Trace.TracestateHeader.literal)),
      })),
  )

const traceStateHeaders = (traceState: string | undefined, headers: Headers.Headers): Headers.Headers =>
  Option.match(Option.fromUndefinedOr(traceState), {
    onNone: () => headers,
    onSome: (state) => Headers.set(headers, Trace.TracestateHeader.literal, state),
  })

const traceHeaders = (parts: Trace.TraceContextParts): Headers.Headers =>
  Option.match(S.encodeOption(Trace.Traceparent)(parts), {
    onNone: () => Headers.empty,
    onSome: (traceparent) =>
      traceStateHeaders(parts.traceState, Headers.set(Headers.empty, Trace.TraceparentHeader.literal, traceparent)),
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
      () => Result.getOrElse(partsOfSpan(api.trace.getSpan(api.context.active())), () => Option.none()),
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

const remoteSpanOf = (context: Context.Context<never>): Option.Option<Tracer.ExternalSpan> =>
  Option.flatMap(Option.flatten(Context.getOption(context, Trace.PropagatedTrace)), externalSpanOf)

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
    Effect.flatMap(Effect.context<never>(), (context) =>
      Option.match(remoteSpanOf(context), {
        onNone: () => Effect.useSpan(spanName, { attributes }, () => effect),
        onSome: (linked) =>
          Effect.useSpan(spanName, { attributes, root: true, links: [{ span: linked, attributes: {} }] }, () => effect),
      })),
)
