import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const WORKER_SERVICE_NAME = 'stryker-js-plugin-worker'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:4318'
const TRACES_SUFFIX = '/v1/traces'

const tracesUrl = (endpoint: string): string => {
  const trimmed = endpoint.replace(/\/+$/u, '')
  if (trimmed.endsWith(TRACES_SUFFIX)) return trimmed
  return `${trimmed}${TRACES_SUFFIX}`
}

const otlpLayer = (serviceName: string, endpoint: string): Layer.Layer<never> =>
  NodeSdk.layer(() => ({
    resource: { serviceName },
    spanProcessor: new SimpleSpanProcessor(new OTLPTraceExporter({ url: tracesUrl(endpoint) })),
  }))

export const workerTelemetryLayer: Layer.Layer<never, Config.ConfigError> = Layer.unwrap(
  Effect.gen(function*() {
    const enabled = yield* Config.Boolean('OTEL_ENABLED').pipe(Config.withDefault(false))
    if (!enabled) return Layer.empty
    const serviceName = yield* Config.String('OTEL_SERVICE_NAME').pipe(Config.withDefault(WORKER_SERVICE_NAME))
    const endpoint = yield* Config.String('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.withDefault(DEFAULT_ENDPOINT))
    return otlpLayer(serviceName, endpoint)
  }),
)
