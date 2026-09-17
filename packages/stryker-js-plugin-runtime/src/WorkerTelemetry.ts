import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'

const WORKER_SERVICE_NAME = 'stryker-js-plugin-worker'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:4318'
const TRACES_SUFFIX = '/v1/traces'

const tracesUrl = (endpoint: string): string => {
  const trimmed = endpoint.replace(/\/+$/u, '')
  if (trimmed.endsWith(TRACES_SUFFIX)) return trimmed
  return `${trimmed}${TRACES_SUFFIX}`
}

const telemetrySettings = (defaultServiceName: string) =>
  Config.all({
    enabled: Config.boolean('OTEL_ENABLED').pipe(Config.withDefault(false)),
    serviceName: Config.string('OTEL_SERVICE_NAME').pipe(Config.withDefault(defaultServiceName)),
    endpoint: Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.withDefault(DEFAULT_ENDPOINT)),
  })

const startTelemetry = async (defaultServiceName: string): Promise<void> => {
  const settings = await Effect.runPromise(telemetrySettings(defaultServiceName))
  if (!settings.enabled) return
  const [{ NodeSDK }, { OTLPTraceExporter }, { SimpleSpanProcessor }] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/sdk-trace-base'),
  ])
  const sdk = new NodeSDK({
    serviceName: settings.serviceName,
    spanProcessors: [
      new SimpleSpanProcessor(
        new OTLPTraceExporter({
          url: tracesUrl(settings.endpoint),
        }),
      ),
    ],
  })
  sdk.start()
}

export const startWorkerTelemetry = (): Promise<void> => startTelemetry(WORKER_SERVICE_NAME)
