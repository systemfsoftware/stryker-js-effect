import { context, trace } from '@opentelemetry/api'
import { Effect, Layer, Tracer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { OtlpExporter, OtlpSerialization, OtlpTracer } from 'effect/unstable/observability'

import { isOpenTelemetryEnabled } from './env.js'
import { serviceName, tracesUrl } from './otel-target.js'

const exportingNothing = Layer.succeed(OtlpExporter.Flusher, {
  flush: Effect.void,
  register: () => Effect.void,
})

/** @param {Readonly<Record<string, string>>} resourceAttributes */
export const layer = (resourceAttributes) =>
  isOpenTelemetryEnabled
    ? OtlpTracer.layer({ url: tracesUrl, resource: { serviceName, attributes: resourceAttributes } }).pipe(
      Layer.provide(OtlpSerialization.layerJson),
      Layer.provide(FetchHttpClient.layer),
    )
    : exportingNothing

/**
 * @template A, E, R
 * @param {Effect.Effect<A, E, R>} effect
 * @returns {Effect.Effect<A, E, R>}
 */
export const underActiveTestSpan = (effect) => {
  const active = trace.getSpan(context.active())
  if (active === undefined) return effect
  const { spanId, traceId } = active.spanContext()
  return Effect.withParentSpan(effect, Tracer.externalSpan({ spanId, traceId }))
}
