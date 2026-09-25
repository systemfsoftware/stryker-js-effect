import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

import { isOpenTelemetryEnabled } from './env.js'
import { serviceName, tracesUrl } from './otel-target.js'

if (process.env['OTEL_DEBUG'] === 'true') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)
}

const sdk = isOpenTelemetryEnabled
  ? new NodeSDK({
    serviceName,
    spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url: tracesUrl }))],
  })
  : undefined

sdk?.start()

export default sdk
