import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

const enabled = process.env['OTEL_ENABLED'] === 'true'

const endpoint = (process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://127.0.0.1:4318').replace(
  /\/+$/u,
  '',
)

const diagnostics = process.env['OTEL_DEBUG'] === 'true'

if (diagnostics) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)
}

const sdk = enabled
  ? new NodeSDK({
    serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'stryker-e2e',
    spanProcessors: [
      new SimpleSpanProcessor(
        new OTLPTraceExporter({
          url: endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`,
        }),
      ),
    ],
  })
  : undefined

sdk?.start()

export default sdk
