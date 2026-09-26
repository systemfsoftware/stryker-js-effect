#!/usr/bin/env node
import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeTerminal from '@effect/platform-node/NodeTerminal'
import { AggregationTemporalityPreference, OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor, SimpleSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
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
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stdio from 'effect/Stdio'
import * as CliConfig from 'effect/unstable/cli/CliConfig'
import * as Command from 'effect/unstable/cli/Command'
import * as Flag from 'effect/unstable/cli/Flag'
import * as GlobalFlag from 'effect/unstable/cli/GlobalFlag'
import { inheritableCompileCacheDirectory } from './enable-compile-cache.js'

import { classifyRunOutcome, RunExit, RunParseFailed } from '../classify-run-outcome.workflow.js'
import { concludeRunCell, runOutcomeCommandOf } from '../conclude-run.cell.js'
import { makeNodePlatformLayer } from '../drivers/node.js'
import { OutputModeProbe, OutputModeProbeLive } from '../output-mode-probe.service.js'
import { FailedRunOutcomeSchema } from '../plan-run-conclusion.workflow.js'
import { MachineConsole } from '../reporting/machine-console.service.js'
import { errorEnvelopeFromOutcome, runExitCodeFromOutcome } from '../reporting/run-failure.js'
import { RunEventDrain, RunEventStreamPort, RunEventStreamPortTag } from '../run-event-stream.service.js'
import { type CliAnswer, type CliEnvironment } from '../run-request.cell.js'
import { RunEnvironment } from '../run/RunEnvironment.service.js'
import { makeStrykerCommand } from './cli-command.js'

globalThis.process.title = 'stryker'

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

const compileCacheChildEnv = inheritableCompileCacheDirectory === undefined
  ? {}
  : { NODE_COMPILE_CACHE: inheritableCompileCacheDirectory }

const nodePlatform = makeNodePlatformLayer({ childEnv: compileCacheChildEnv })

const probeGroup = Layer.mergeAll(
  OutputModeProbeLive,
  RunEventStreamPortTag.layer.pipe(Layer.provide(RunEventDrain.fileLayer)),
  RunEventDrain.fileLayer,
).pipe(Layer.provide(nodePlatform))

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
).pipe(Layer.provideMerge(nodePlatform))

const USAGE_EXIT_CODE = runExitCodeFromOutcome(RunParseFailed.make({})).code

const SPAN_ERROR_LIMIT = 1024
const TRUNCATION_SUFFIX = '…[truncated]'

const boundedErrorText = (text: string): string =>
  text.length > SPAN_ERROR_LIMIT ? text.slice(0, SPAN_ERROR_LIMIT) + TRUNCATION_SUFFIX : text

const strykerProgram = Effect.gen(function*() {
  const stdio = yield* Stdio.Stdio
  const outputMode = yield* OutputModeProbe
  const detected = yield* Effect.result(outputMode.detectMode)
  const mode = yield* Result.match(detected, {
    onFailure: (failure) =>
      Console.error(failure.message).pipe(
        Effect.andThen(Effect.fail(RunExit.make({ code: USAGE_EXIT_CODE }))),
      ),
    onSuccess: (success) => Effect.succeed(success),
  })
  const runEvents = yield* RunEventStreamPort
  const stream = yield* runEvents.createRunEventStream(mode)
  const noColor = yield* Config.String('NO_COLOR').pipe(Effect.option)
  const host = yield* RunEnvironment.forStream(mode, stream, {
    noColor: Option.getOrUndefined(noColor),
    builtinReporters: { html: HtmlReporter.makeHtmlReporter },
  })
  const pathService = yield* Path.Path
  const realConsole = yield* Console.Console
  const environment: CliEnvironment = {
    mode,
    stream,
    host: { env: host, events: stream.queue },
    basePath: host.basePath,
    pathService,
    runEvents,
    console: realConsole,
  }
  const args = [...(yield* stdio.args)]
  const answer = yield* Ref.make<CliAnswer>(undefined)
  const command = makeStrykerCommand({ environment, recordAnswer: (recorded) => Ref.set(answer, recorded) })
  const machineConsole = Boolean.match(mode.mode === 'machine', {
    onTrue: () => MachineConsole.captureLayer,
    onFalse: () => Layer.empty,
  })
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.withSpan('stryker.cli.run')(
      Effect.gen(function*() {
        const exit = yield* Effect.exit(
          restore(
            Command.runWith(command, { version: cliPkgJson.version })(args).pipe(
              Effect.provide(machineConsole),
              Effect.andThen(Ref.get(answer)),
            ),
          ),
        )
        const conclusionCommand = runOutcomeCommandOf({ exit, argv: args })
        const outcome = classifyRunOutcome(conclusionCommand)
        const classified = Result.getOrElse(
          outcome,
          (interrupted) => interrupted,
        )
        const machineConsoleService = yield* MachineConsole
        const errorText = Option.getOrElse(
          Option.map(
            Option.liftPredicate(S.is(FailedRunOutcomeSchema))(classified),
            (failure) =>
              boundedErrorText(
                errorEnvelopeFromOutcome({ error: failure, captured: machineConsoleService.read() }).error,
              ),
          ),
          () => '',
        )
        yield* Effect.annotateCurrentSpan({
          'stryker.run.outcome': classified._tag,
          'stryker.run.exit_code': runExitCodeFromOutcome(classified).code,
          'stryker.run.error': errorText,
        })
        return yield* concludeRunCell.run({
          mode,
          stream,
          basePath: host.basePath,
          pathService,
          runEvents,
          concluded: { command: conclusionCommand, outcome, error: errorText },
        })
      }),
    )
  )
})

const program = Effect.scoped(
  cliLayer.pipe(
    Layer.build,
    Effect.flatMap((context) =>
      Effect.provideContext(strykerProgram.pipe(Effect.provideService(Logger.LogToStderr, true)), context)
    ),
  ),
)
NodeRuntime.runMain({ disableErrorReporting: true })(program)
