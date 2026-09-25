import type { Effect, Layer } from 'effect'
import type { OtlpExporter } from 'effect/unstable/observability'

declare const layer: (resourceAttributes: Readonly<Record<string, string>>) => Layer.Layer<OtlpExporter.Flusher>
declare const underActiveTestSpan: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>

export { layer, underActiveTestSpan }
