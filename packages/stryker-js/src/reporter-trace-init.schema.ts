import {
  TraceContextPartsSchema,
  Traceparent,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { TraceContextPartsFromEffectSpan } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import type { ReporterInit } from '@systemfsoftware/stryker-js-plugin-interface'
import type { PhaseSpan } from './reporter-stream.service.js'

export class TraceInitIssue extends S.TaggedError<TraceInitIssue>()('TraceInitIssue', {
  phase: S.Literals(['decode', 'encode']),
  reason: S.String,
  cause: S.optional(S.Defect()),
}) {}

export class ReporterStreamInvariantBroken extends S.TaggedError<ReporterStreamInvariantBroken>()(
  'ReporterStreamInvariantBroken',
  { detail: S.String, span: S.Unknown },
) {}

const absentReporterInit = (): ReporterTraceInit =>
  ReporterTraceInit.make({
    traceSource: 'span',
    parts: undefined,
    traceparent: undefined,
    tracestate: undefined,
  })

export class ReporterTraceInit extends S.TaggedClass<ReporterTraceInit>()('ReporterTraceInit', {
  traceSource: S.Literal('span'),
  parts: S.optional(TraceContextPartsSchema),
  traceparent: S.optional(S.String),
  tracestate: S.optional(S.String),
}) {
  static readonly fromSpan = (span: PhaseSpan | undefined): Effect.Effect<ReporterInit | undefined, TraceInitIssue> =>
    Option.match(Option.fromNullishOr(span), {
      onNone: () => Effect.succeed(absentReporterInit()),
      onSome: (present) =>
        Option.match(S.decodeOption(TraceContextPartsFromEffectSpan)(present), {
          onNone: () =>
            Effect.fail(
              TraceInitIssue.make({ phase: 'decode', reason: 'span refused by TraceContextPartsFromEffectSpan' }),
            ),
          onSome: (parts) =>
            S.encodeEffect(Traceparent)(parts).pipe(
              Effect.mapError((cause) =>
                TraceInitIssue.make({ phase: 'encode', reason: 'parts refused by Traceparent', cause })
              ),
              Effect.map((traceparent): ReporterInit => ({
                traceparent,
                ...(parts.traceState === undefined ? {} : { tracestate: parts.traceState }),
              })),
            ),
        }),
    })
}
