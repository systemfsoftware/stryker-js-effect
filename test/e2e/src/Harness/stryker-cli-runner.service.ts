import { Config, Context, Crypto, Effect, Layer, Option } from 'effect'
import type { Scope } from 'effect'

import type { ExecResult } from './guest-job.schema.js'
import type { SandboxForkFailure } from './harness-failure.schema.js'
import { seamSpan, SpanNames } from './harness-telemetry.service.js'
import * as Warm from './warm-sandbox.handle.js'

const guestEnvironment = (env: {
  readonly OTEL_ENABLED?: string | undefined
  readonly OTEL_SERVICE_NAME?: string | undefined
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string | undefined
}) => ({
  STRYKER_MODE: 'machine',
  OTEL_ENABLED: env['OTEL_ENABLED'] ?? 'false',
  OTEL_SERVICE_NAME: env['OTEL_SERVICE_NAME'] ?? 'stryker-e2e',
  OTEL_EXPORTER_OTLP_ENDPOINT: (env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://127.0.0.1:4318')
    .replace('127.0.0.1', 'host.microsandbox.internal')
    .replace('localhost', 'host.microsandbox.internal'),
})

export interface ForkedRun {
  readonly result: ExecResult
  readonly fork: Warm.SandboxFork
}

const runStrykerCli = (args: ReadonlyArray<string>, warm: Warm.WarmSandbox, label: string) =>
  Effect.gen(function*() {
    const enabled = yield* Config.option(Config.String('OTEL_ENABLED'))
    const service = yield* Config.option(Config.String('OTEL_SERVICE_NAME'))
    const endpoint = yield* Config.option(Config.String('OTEL_EXPORTER_OTLP_ENDPOINT'))
    const fork = yield* Warm.fork(warm, label)
    const result = yield* Warm.exec(
      fork,
      ['npx', '--no-install', 'stryker', ...args],
      guestEnvironment({
        OTEL_ENABLED: Option.getOrUndefined(enabled),
        OTEL_SERVICE_NAME: Option.getOrUndefined(service),
        OTEL_EXPORTER_OTLP_ENDPOINT: Option.getOrUndefined(endpoint),
      }),
    )
    const run: ForkedRun = { result, fork }
    return run
  }).pipe(seamSpan(SpanNames.cliRun, { 'e2e.cli.args': args.join(' ') }))

export interface StrykerCliRunnerShape {
  readonly run: (
    args: ReadonlyArray<string>,
    warm: Warm.WarmSandbox,
    label: string,
  ) => Effect.Effect<ForkedRun, Config.ConfigError | SandboxForkFailure, Crypto.Crypto | Scope.Scope>
}

export class StrykerCliRunner extends Context.Service<StrykerCliRunner, StrykerCliRunnerShape>()(
  '@systemfsoftware/stryker-e2e/Harness/StrykerCliRunner',
) {
  static readonly layer = Layer.effect(
    StrykerCliRunner,
    Effect.sync(() => ({
      run: (args: ReadonlyArray<string>, warm: Warm.WarmSandbox, label: string) => runStrykerCli(args, warm, label),
    })),
  )
}
