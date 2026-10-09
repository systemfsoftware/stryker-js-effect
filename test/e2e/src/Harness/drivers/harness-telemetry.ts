import * as TestTelemetry from '@systemfsoftware/vitest-config/telemetry'
import type { Layer } from 'effect'
import type { OtlpExporter } from 'effect/observability'

import { COMPONENT_ATTRIBUTE } from '../seam-span.js'

export const layer: Layer.Layer<OtlpExporter.Flusher> = TestTelemetry.layer({ [COMPONENT_ATTRIBUTE]: 'harness' })
