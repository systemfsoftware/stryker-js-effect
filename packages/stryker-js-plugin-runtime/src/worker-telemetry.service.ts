import * as Context from 'effect/Context'

import type { WorkerTelemetryConfig } from './worker-telemetry.schema.js'

export class WorkerTelemetry extends Context.Service<WorkerTelemetry, WorkerTelemetryConfig>()(
  '@systemfsoftware/stryker-js-plugin-runtime/worker-telemetry.service/WorkerTelemetry',
) {}
