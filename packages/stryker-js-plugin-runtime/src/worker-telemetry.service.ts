import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Layer from 'effect/Layer'

import { TracesUrl, WorkerTelemetryConfig } from './worker-telemetry.schema.js'

const WORKER_SERVICE_NAME = 'stryker-js-plugin-worker'
const DEFAULT_TRACES_URL = 'http://127.0.0.1:4318/v1/traces'

const workerTelemetryConfig: Config.Config<WorkerTelemetryConfig> = Config.all({
  enabled: Config.Boolean('OTEL_ENABLED').pipe(Config.withDefault(false)),
  serviceName: Config.String('OTEL_SERVICE_NAME').pipe(Config.withDefault(WORKER_SERVICE_NAME)),
  endpoint: Config.schema(TracesUrl, 'OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.withDefault(DEFAULT_TRACES_URL)),
})

export class WorkerTelemetry extends Context.Service<WorkerTelemetry, WorkerTelemetryConfig>()(
  '@systemfsoftware/stryker-js-plugin-runtime/worker-telemetry.service/WorkerTelemetry',
) {
  static readonly layer: Layer.Layer<WorkerTelemetry, Config.ConfigError> = Layer.effect(
    WorkerTelemetry,
    Config.map(workerTelemetryConfig, WorkerTelemetry.of),
  )
}
