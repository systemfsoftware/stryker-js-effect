import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BatchSpanProcessor, SimpleSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base'
import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Scope from 'effect/Scope'

const SHUTDOWN_TIMEOUT = Duration.seconds(3)
const EXPORT_TIMEOUT_MILLIS = 5000

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
          Effect.ignoreCause,
        ),
    ).pipe(Effect.map(({ context }) => context)),
  )

const PROCESSOR_BY_KIND: Record<'simple' | 'batch', (exporter: OTLPTraceExporter) => SpanProcessor> = {
  batch: (exporter) => new BatchSpanProcessor(exporter),
  simple: (exporter) => new SimpleSpanProcessor(exporter),
}

const TRACES_PATH = '/v1/traces'

const tracesUrlFor = (endpoint: string | undefined): string | undefined =>
  Option.match(Option.fromUndefinedOr(endpoint), {
    onNone: () => undefined,
    onSome: (base) => {
      const trimmed = base.replace(/\/+$/u, '')
      return Match.value(trimmed.endsWith(TRACES_PATH)).pipe(
        Match.when(true, () => trimmed),
        Match.orElse(() => `${trimmed}${TRACES_PATH}`),
      )
    },
  })

const exporterOptionsFor = (endpoint: string | undefined): { readonly url?: string; readonly timeoutMillis: number } =>
  Match.value(tracesUrlFor(endpoint)).pipe(
    Match.when(undefined, () => ({ timeoutMillis: EXPORT_TIMEOUT_MILLIS })),
    Match.orElse((url) => ({ url, timeoutMillis: EXPORT_TIMEOUT_MILLIS })),
  )

export const otlpTelemetryLayer = (options: {
  readonly serviceName: string
  readonly endpoint?: string | undefined
  readonly processor?: 'simple' | 'batch' | undefined
}): Layer.Layer<never> => {
  const exporter = new OTLPTraceExporter(exporterOptionsFor(options.endpoint))
  return withBestEffortShutdown(
    NodeSdk.layer(() => ({
      resource: { serviceName: options.serviceName },
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
  ]).pipe(
    Effect.orElseSucceed(() => [false, 'stryker-js', 'http://127.0.0.1:4318'] as const),
    Effect.map(([enabled, serviceName, endpoint]) =>
      Match.value(enabled).pipe(
        Match.when(true, () => otlpTelemetryLayer({ serviceName, endpoint })),
        Match.orElse(() => Layer.empty),
      )
    ),
  ),
)
