import { context, trace } from '@opentelemetry/api'
import { Config, Effect, Layer, Option, Tracer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { OtlpExporter, OtlpSerialization, OtlpTracer } from 'effect/unstable/observability'

const ENABLED_VALUE = 'true'
const DEFAULT_SERVICE_NAME = 'stryker-e2e'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:4318'
const TRACES_PATH = '/v1/traces'

export const COMPONENT_ATTRIBUTE = 'e2e.component'

export const SpanNames = {
  setup: 'e2e.setup',
  prune: 'e2e.setup.prune',
  pack: 'e2e.setup.pack',
  packBuild: 'e2e.setup.pack.build',
  packTarballs: 'e2e.setup.pack.tarballs',
  packsKey: 'e2e.setup.key.packs',
  packsKeyUnpack: 'e2e.setup.key.packs.unpack',
  fixtureKeys: 'e2e.setup.key.fixtures',
  fixtureKey: 'e2e.setup.key.fixtures.fixture',
  bake: 'e2e.setup.bake',
  install: 'e2e.fixture.install',
  guestJob: 'e2e.guest.job',
  cliRun: 'e2e.cli.run',
} as const

const stringOption = (name: string) => Config.option(Config.String(name))

const tracesUrl = (endpoint: string): string => {
  const trimmed = endpoint.replace(/\/+$/u, '')
  return trimmed.endsWith(TRACES_PATH) ? trimmed : `${trimmed}${TRACES_PATH}`
}

const noopFlusher: Layer.Layer<OtlpExporter.Flusher> = Layer.succeed(OtlpExporter.Flusher, {
  flush: Effect.void,
  register: () => Effect.void,
})

const configured = Effect.gen(function*() {
  const enabled = yield* stringOption('OTEL_ENABLED')
  if (Option.getOrUndefined(enabled) !== ENABLED_VALUE) {
    return noopFlusher
  }
  const serviceName = yield* stringOption('OTEL_SERVICE_NAME')
  const endpoint = yield* stringOption('OTEL_EXPORTER_OTLP_ENDPOINT')
  return OtlpTracer.layer({
    url: tracesUrl(Option.getOrElse(endpoint, () => DEFAULT_ENDPOINT)),
    resource: {
      serviceName: Option.getOrElse(serviceName, () => DEFAULT_SERVICE_NAME),
      attributes: { [COMPONENT_ATTRIBUTE]: 'harness' },
    },
  }).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
  )
})

export const layer: Layer.Layer<OtlpExporter.Flusher> = Layer.unwrap(Effect.orDie(configured))

export const withSeamSpan = <A, E, R>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.withSpan(effect, name, { attributes })

export const seamSpan = (
  name: string,
  attributes: Record<string, string | number | boolean>,
): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> =>
(effect) => Effect.withSpan(effect, name, { attributes })

export const activeParentSpan = (): Tracer.ExternalSpan | undefined => {
  const active = trace.getSpan(context.active())
  if (active === undefined) {
    return undefined
  }
  const spanContext = active.spanContext()
  return Tracer.externalSpan({ spanId: spanContext.spanId, traceId: spanContext.traceId })
}

export const underActiveParentSpan = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
  const parent = activeParentSpan()
  return parent === undefined ? effect : Effect.withParentSpan(effect, parent)
}
