import * as api from '@opentelemetry/api'
import * as Boolean from 'effect/Boolean'
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
  TraceContextPartsSchema,
  TraceContextReference,
  Traceparent,
  TraceparentHeader,
  TracestateHeader,
} from '@systemfsoftware/stryker-js-plugin-interface'

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
      S.decodeOption(TraceContextPartsSchema)({
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

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')

  const traceIdArbitrary = Arbitrary.filter(
    Arbitrary.schema(S.String.check(S.isPattern(/^[0-9a-f]{32}$/))),
    (id) => /^[1-9a-f][0-9a-f]*$/.test(id),
  )
  const spanIdArbitrary = Arbitrary.filter(
    Arbitrary.schema(S.String.check(S.isPattern(/^[0-9a-f]{16}$/))),
    (id) => /^[1-9a-f][0-9a-f]*$/.test(id),
  )
  const flagsArbitrary = Arbitrary.schema(S.Int.pipe(S.check(S.isBetween({ minimum: 0, maximum: 255 }))))
  const traceStateArbitrary = Arbitrary.map(
    Arbitrary.schema(S.Literals(['absent', 'k=v', 'a=1,b=2', 'x=y,z=w'])),
    (pick) =>
      Boolean.match(pick === 'absent', {
        onTrue: () => Option.none<string>(),
        onFalse: () => Option.some(pick),
      }),
  )

  const contextFixture = (traceId: string, spanId: string, traceFlags: number, traceState: Option.Option<string>) => ({
    traceId,
    spanId,
    traceFlags,
    ...Option.match(Option.map(traceState, (state) => api.createTraceState(state)), {
      onNone: () => ({}),
      onSome: (state) => ({ traceState: state }),
    }),
    isRemote: false,
  })

  const traceIdMatches = (traceId: string) => (parts: TraceContextParts) => parts.traceId === traceId

  const spanIdMatches = (spanId: string) => (parts: TraceContextParts) => parts.spanId === spanId

  const flagsMatch = (traceFlags: number) => (parts: TraceContextParts) => parts.traceFlags === traceFlags

  const conservedIds =
    (traceId: string, spanId: string, traceFlags: number) => (parts: TraceContextParts) =>
      [traceIdMatches(traceId)(parts), spanIdMatches(spanId)(parts), flagsMatch(traceFlags)(parts)].every(
        (holds) => holds,
      )

  it.prop(
    '∀trace_span_flags_Identity_IdsConserved',
    [traceIdArbitrary, spanIdArbitrary, flagsArbitrary],
    ([traceId, spanId, traceFlags]) =>
      Option.match(partsOfSpanContext(contextFixture(traceId, spanId, traceFlags, Option.none<string>())), {
        onNone: () => false,
        onSome: conservedIds(traceId, spanId, traceFlags),
      }),
  )

  const fixtureEnvelope = (traceState: Option.Option<string>) =>
    partsOfSpanContext(contextFixture('a'.repeat(32), 'b'.repeat(16), 1, traceState))

  it.prop(
    '∀trace_state_Envelope_VersionAndStateConserved',
    [traceStateArbitrary],
    ([traceState]) =>
      Option.match(fixtureEnvelope(traceState), {
        onNone: () => false,
        onSome: (parts) =>
          parts.version === '00' &&
          parts.traceState === Option.getOrUndefined(Option.map(traceState, (state) => state)),
      }),
  )

  const invalidTraceIdArbitrary = Arbitrary.schema(
    S.Literals(['0'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), `${'a'.repeat(31)}g`]),
  )

  const invalidSpanIdArbitrary = Arbitrary.schema(
    S.Literals(['0'.repeat(16), 'a'.repeat(15), 'a'.repeat(17), `${'a'.repeat(15)}g`]),
  )

  const refusedFixture = (context: api.SpanContext, badTraceId: string, badSpanId: string) =>
    [
      Option.isNone(partsOfSpanContext({ ...context, traceId: badTraceId })),
      Option.isNone(partsOfSpanContext({ ...context, spanId: badSpanId })),
    ].every((refused) => refused)

  it.prop(
    '∀trace_span_flags_state_InvalidSpanContext_DecodeNone',
    [traceIdArbitrary, spanIdArbitrary, flagsArbitrary, traceStateArbitrary, invalidTraceIdArbitrary, invalidSpanIdArbitrary],
    ([traceId, spanId, traceFlags, traceState, badTraceId, badSpanId]) =>
      refusedFixture(contextFixture(traceId, spanId, traceFlags, traceState), badTraceId, badSpanId),
  )
}
