import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

const endpoint = (process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://127.0.0.1:4318').replace(
  /\/+$/u,
  '',
)

const sdk = new NodeSDK({
  serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'stryker-js-cli-e2e',
  spanProcessors: [
    new SimpleSpanProcessor(
      new OTLPTraceExporter({
        url: endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`,
      }),
    ),
  ],
})

sdk.start()

export default sdk
