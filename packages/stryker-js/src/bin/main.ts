#!/usr/bin/env node
import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeTerminal from '@effect/platform-node/NodeTerminal'
import { AggregationTemporalityPreference, OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor, SimpleSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base'
import cliPkgJson from '@systemfsoftware/stryker-js/package.json' with { type: 'json' }
import * as Boolean from 'effect/Boolean'
import * as Cause from 'effect/Cause'
import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as EffectDuration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Scope from 'effect/Scope'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'
import * as CliConfig from 'effect/unstable/cli/CliConfig'
import * as Flag from 'effect/unstable/cli/Flag'
import * as GlobalFlag from 'effect/unstable/cli/GlobalFlag'

import { strykerCliEffect } from '../Cli.cell.js'
import { nodePlatformLayer } from '../drivers/node.js'
import { OutputModeProbe, OutputModeProbeLive } from '../output-mode-probe.service.js'
import { MachineConsole } from '../reporting/machine-console.service.js'
import { RunEventDrain, RunEventStreamPort, RunEventStreamPortTag } from '../run-event-stream.service.js'
import { UnsupportedNodeVersion } from './main.schema.js'

globalThis.process.title = 'stryker'

const versionNumbers = (version: string): readonly number[] =>
  version
    .replace(/^v/, '')
    .split(/[-+]/)
    .slice(0, 1)
    .flatMap((base) => base.split('.'))
    .map((part) => Number.parseInt(part, 10))

const componentAt = (numbers: readonly number[], index: number): number =>
  Option.getOrElse(Option.fromUndefinedOr(numbers[index]), () => 0)

const SUPPORTED_NODE_MAJOR = 20

const NODE_VERSION_REJECTIONS: readonly ((numbers: readonly number[]) => boolean)[] = [
  (numbers) => numbers.some(Number.isNaN),
  (numbers) => componentAt(numbers, 0) < SUPPORTED_NODE_MAJOR,
]

const isSupportedNodeVersion = (version: string) =>
  !NODE_VERSION_REJECTIONS.some((rejects) => rejects(versionNumbers(version)))

const unsupportedNodeVersion = (version: string) =>
  UnsupportedNodeVersion.make({ version, required: cliPkgJson.engines.node })

const checkNodeVersion = (stdio: Stdio.Stdio, version: string) =>
  Effect.flatMap(Effect.succeed(isSupportedNodeVersion(version)), (supported) =>
    Boolean.match(supported, {
      onTrue: () => Effect.void,
      onFalse: () => {
        const failure = unsupportedNodeVersion(version)
        return Stream.run(Stream.make(`${failure.message}\n`), stdio.stderr()).pipe(
          Effect.andThen(Effect.fail(failure)),
        )
      },
    }))

const EXPORT_TIMEOUT_MILLIS = 5000
const SHUTDOWN_TIMEOUT = EffectDuration.millis(EXPORT_TIMEOUT_MILLIS + 1_000)

const withBestEffortShutdown = <A, E>(
  self: Layer.Layer<A, E>,
  shutdownTimeout: EffectDuration.Duration,
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

const otlpTelemetryLayer = (options: {
  readonly serviceName: string
  readonly endpoint?: string | undefined
  readonly processor?: 'simple' | 'batch' | undefined
  readonly metricExportIntervalMillis?: number | undefined
}): Layer.Layer<never> => {
  const exporter = new OTLPTraceExporter(resourceUrlFor(options.endpoint, TRACES_PATH))
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

const telemetryLayer: Layer.Layer<never> = Layer.unwrap(
  Effect.all([
    Config.Boolean('OTEL_ENABLED').pipe(Config.withDefault(false)),
    Config.String('OTEL_SERVICE_NAME').pipe(Config.withDefault('stryker-js')),
    Config.String('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.withDefault('http://127.0.0.1:4318')),
    Config.Number('OTEL_METRIC_EXPORT_INTERVAL').pipe(Config.withDefault(DEFAULT_METRIC_EXPORT_INTERVAL_MILLIS)),
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

const probeGroup = Layer.mergeAll(
  OutputModeProbeLive,
  RunEventStreamPortTag.layer.pipe(Layer.provide(RunEventDrain.fileLayer)),
  RunEventDrain.fileLayer,
).pipe(Layer.provide(nodePlatformLayer))

const cliLayer = Layer.mergeAll(
  probeGroup,
  telemetryLayer,
  MachineConsole.layer,
  CliConfig.layer({
    builtIns: [
      GlobalFlag.Help,
      GlobalFlag.Action({
        flag: Flag.Boolean('version').pipe(Flag.withAlias('v'), Flag.withDescription('Show version information')),
        run: () => Console.log(cliPkgJson.version),
      }),
      GlobalFlag.Wizard,
      GlobalFlag.Completions,
      GlobalFlag.LogLevel,
    ],
  }),
  NodeTerminal.layer,
).pipe(Layer.provideMerge(nodePlatformLayer))

const program = Effect.scoped(
  cliLayer.pipe(
    Layer.build,
    Effect.flatMap((context) =>
      Effect.provideContext(
        Effect.gen(function*() {
          const stdio = yield* Stdio.Stdio
          yield* checkNodeVersion(stdio, globalThis.process.version)
          const outputMode = yield* OutputModeProbe
          const runEvents = yield* RunEventStreamPort
          const args = [...(yield* stdio.args)]
          yield* strykerCliEffect({
            argv: args,
            runMutationTest: undefined,
            detectMode: outputMode.detectMode,
            runEvents,
          })
        }).pipe(Effect.provideService(Logger.LogToStderr, true)),
        context,
      )
    ),
  ),
)
NodeRuntime.runMain({ disableErrorReporting: true })(program)
