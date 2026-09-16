const WORKER_SERVICE_NAME = 'stryker-js-plugin-worker'
const HOST_SERVICE_NAME = 'stryker-js-cli'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:4318'
const TRACES_SUFFIX = '/v1/traces'

export const workerTelemetryEnabled = (): boolean => process.env['OTEL_ENABLED'] === 'true'

const envOr = (name: string, fallback: string): string => process.env[name] ?? fallback

const tracesUrl = (endpoint: string): string => {
  const trimmed = endpoint.replace(/\/+$/u, '')
  if (trimmed.endsWith(TRACES_SUFFIX)) return trimmed
  return `${trimmed}${TRACES_SUFFIX}`
}

const startTelemetry = async (defaultServiceName: string): Promise<void> => {
  if (!workerTelemetryEnabled()) return
  const [{ NodeSDK }, { OTLPTraceExporter }, { SimpleSpanProcessor }] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/sdk-trace-base'),
  ])
  const sdk = new NodeSDK({
    serviceName: envOr('OTEL_SERVICE_NAME', defaultServiceName),
    spanProcessors: [
      new SimpleSpanProcessor(
        new OTLPTraceExporter({
          url: tracesUrl(envOr('OTEL_EXPORTER_OTLP_ENDPOINT', DEFAULT_ENDPOINT)),
        }),
      ),
    ],
  })
  sdk.start()
}

export const startWorkerTelemetry = (): Promise<void> => startTelemetry(WORKER_SERVICE_NAME)

export const startHostTelemetry = (): Promise<void> => startTelemetry(HOST_SERVICE_NAME)
