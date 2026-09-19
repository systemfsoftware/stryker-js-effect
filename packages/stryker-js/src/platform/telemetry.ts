import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { AggregationTemporalityPreference, OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor, SimpleSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base'
import * as Cause from 'effect/Cause'
import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Scope from 'effect/Scope'

const EXPORT_TIMEOUT_MILLIS = 5000
const SHUTDOWN_TIMEOUT = Duration.millis(EXPORT_TIMEOUT_MILLIS + 1_000)

const withBestEffortShutdown = <A, E>(
  self: Layer.Layer<A, E>,
  shutdownTimeout: Duration.Duration,
): Layer.Layer<A, E> =>
  Layer.effectContext(
    Effect.acquireRelease(
      Effect.gen(function*() {
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(self, scope)
        return { context, scope }
      }),
      ({ scope }) =>
        Scope.close(scope, Exit.void).pipe(
          Effect.interruptible,
          Effect.timeoutOption(shutdownTimeout),
          Effect.tapCause((cause) => Effect.logWarning(`Telemetry shutdown did not complete: ${Cause.pretty(cause)}`)),
          Effect.ignoreCause,
        ),
    ).pipe(Effect.map(({ context }) => context)),
  )

const PROCESSOR_BY_KIND: Record<'simple' | 'batch', (exporter: OTLPTraceExporter) => SpanProcessor> = {
  batch: (exporter) => new BatchSpanProcessor(exporter),
  simple: (exporter) => new SimpleSpanProcessor(exporter),
}

const TRACES_PATH = '/v1/traces'
const METRICS_PATH = '/v1/metrics'
const DEFAULT_METRIC_EXPORT_INTERVAL_MILLIS = 60_000

const SIGNAL_PATH = /\/(?:v1|v1\/(?:traces|metrics))$/u

const urlFor = (endpoint: string | undefined, path: string): string | undefined =>
  Option.match(Option.fromUndefinedOr(endpoint), {
    onNone: () => undefined,
    onSome: (base) => `${base.replace(/\/+$/u, '').replace(SIGNAL_PATH, '')}${path}`,
  })

const resourceUrlFor = (
  endpoint: string | undefined,
  path: string,
): { readonly url?: string; readonly timeoutMillis: number } =>
  Match.value(urlFor(endpoint, path)).pipe(
    Match.when(undefined, () => ({ timeoutMillis: EXPORT_TIMEOUT_MILLIS })),
    Match.orElse((url) => ({ url, timeoutMillis: EXPORT_TIMEOUT_MILLIS })),
  )

const exporterOptionsFor = (endpoint: string | undefined): { readonly url?: string; readonly timeoutMillis: number } =>
  resourceUrlFor(endpoint, TRACES_PATH)

export const otlpTelemetryLayer = (options: {
  readonly serviceName: string
  readonly endpoint?: string | undefined
  readonly processor?: 'simple' | 'batch' | undefined
  readonly metricExportIntervalMillis?: number | undefined
}): Layer.Layer<never> => {
  const exporter = new OTLPTraceExporter(exporterOptionsFor(options.endpoint))
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      ...resourceUrlFor(options.endpoint, METRICS_PATH),
      temporalityPreference: AggregationTemporalityPreference.CUMULATIVE,
    }),
    exportIntervalMillis: options.metricExportIntervalMillis ?? DEFAULT_METRIC_EXPORT_INTERVAL_MILLIS,
  })
  return withBestEffortShutdown(
    NodeSdk.layer(() => ({
      resource: { serviceName: options.serviceName },
      metricReader,
      spanProcessor: Match.value(options.processor ?? 'simple').pipe(
        Match.when('batch', (kind) => PROCESSOR_BY_KIND[kind](exporter)),
        Match.orElse((kind) => PROCESSOR_BY_KIND[kind](exporter)),
      ),
    })),
    SHUTDOWN_TIMEOUT,
  )
}

export const telemetryLayer: Layer.Layer<never> = Layer.unwrap(
  Effect.all([
    Config.boolean('OTEL_ENABLED').pipe(Config.withDefault(false)),
    Config.string('OTEL_SERVICE_NAME').pipe(Config.withDefault('stryker-js')),
    Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.withDefault('http://127.0.0.1:4318')),
    Config.number('OTEL_METRIC_EXPORT_INTERVAL').pipe(Config.withDefault(DEFAULT_METRIC_EXPORT_INTERVAL_MILLIS)),
  ]).pipe(
    Effect.orElseSucceed(
      () => [false, 'stryker-js', 'http://127.0.0.1:4318', DEFAULT_METRIC_EXPORT_INTERVAL_MILLIS] as const,
    ),
    Effect.map(([enabled, serviceName, endpoint, metricExportIntervalMillis]) =>
      Match.value(enabled).pipe(
        Match.when(true, () => otlpTelemetryLayer({ serviceName, endpoint, metricExportIntervalMillis })),
        Match.orElse(() => Layer.empty),
      )
    ),
  ),
)
