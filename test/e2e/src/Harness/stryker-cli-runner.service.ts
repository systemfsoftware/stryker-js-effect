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
  ALLOW_LOCAL_MUTATION: '1',
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

export interface ForkedStreamedRun {
  readonly result: Warm.StreamedExecResult
  readonly fork: Warm.SandboxFork
}

const STRYKER_CLI: readonly [string, ...Array<string>] = ['npx', '--no-install', 'stryker']

const cliArgvOf = (args: ReadonlyArray<string>): [string, ...Array<string>] => [...STRYKER_CLI, ...args]

const guestEnvironmentOf = (
  runEnvironment: Readonly<Record<string, string>> | undefined,
): Effect.Effect<Record<string, string>, Config.ConfigError> =>
  Effect.gen(function*() {
    const enabled = yield* Config.option(Config.String('OTEL_ENABLED'))
    const service = yield* Config.option(Config.String('OTEL_SERVICE_NAME'))
    const endpoint = yield* Config.option(Config.String('OTEL_EXPORTER_OTLP_ENDPOINT'))
    return {
      ...guestEnvironment({
        OTEL_ENABLED: Option.getOrUndefined(enabled),
        OTEL_SERVICE_NAME: Option.getOrUndefined(service),
        OTEL_EXPORTER_OTLP_ENDPOINT: Option.getOrUndefined(endpoint),
      }),
      ...runEnvironment,
    }
  })

const execInFork = (
  argv: readonly [string, ...Array<string>],
  warm: Warm.WarmSandbox,
  label: string,
  runEnvironment: Readonly<Record<string, string>> | undefined,
) =>
  Effect.gen(function*() {
    const environment = yield* guestEnvironmentOf(runEnvironment)
    const fork = yield* Warm.fork(warm, label)
    const result = yield* Warm.exec(fork, argv, environment)
    const run: ForkedRun = { result, fork }
    return run
  })

const runStrykerCli = (
  args: ReadonlyArray<string>,
  warm: Warm.WarmSandbox,
  label: string,
  runEnvironment: Readonly<Record<string, string>> | undefined,
) =>
  execInFork(cliArgvOf(args), warm, label, runEnvironment).pipe(
    seamSpan(SpanNames.cliRun, { 'e2e.cli.args': args.join(' ') }),
  )

const streamStrykerCli = (
  args: ReadonlyArray<string>,
  warm: Warm.WarmSandbox,
  label: string,
  runEnvironment: Readonly<Record<string, string>> | undefined,
  interruptOnLine: (line: string, readGuestFile: Warm.GuestFileReader) => Promise<boolean>,
) =>
  Effect.gen(function*() {
    const environment = yield* guestEnvironmentOf(runEnvironment)
    const fork = yield* Warm.fork(warm, label)
    const result = yield* Warm.execStreaming(fork, cliArgvOf(args), { env: environment, interruptOnLine })
    const run: ForkedStreamedRun = { result, fork }
    return run
  }).pipe(seamSpan(SpanNames.cliRun, { 'e2e.cli.args': args.join(' '), 'e2e.cli.interruptible': true }))

const runGuestCommand = (
  argv: readonly [string, ...Array<string>],
  warm: Warm.WarmSandbox,
  label: string,
  runEnvironment: Readonly<Record<string, string>> | undefined,
) => execInFork(argv, warm, label, runEnvironment).pipe(seamSpan(SpanNames.cliRun, { 'e2e.cli.args': label }))

export interface StrykerCliRunnerShape {
  readonly run: (
    args: ReadonlyArray<string>,
    warm: Warm.WarmSandbox,
    label: string,
    runEnvironment?: Readonly<Record<string, string>> | undefined,
  ) => Effect.Effect<ForkedRun, Config.ConfigError | SandboxForkFailure, Crypto.Crypto | Scope.Scope>
  readonly streamRun: (
    args: ReadonlyArray<string>,
    warm: Warm.WarmSandbox,
    label: string,
    runEnvironment: Readonly<Record<string, string>> | undefined,
    interruptOnLine: (line: string, readGuestFile: Warm.GuestFileReader) => Promise<boolean>,
  ) => Effect.Effect<ForkedStreamedRun, Config.ConfigError | SandboxForkFailure, Crypto.Crypto | Scope.Scope>
  readonly guest: (
    argv: readonly [string, ...Array<string>],
    warm: Warm.WarmSandbox,
    label: string,
    runEnvironment?: Readonly<Record<string, string>> | undefined,
  ) => Effect.Effect<ForkedRun, Config.ConfigError | SandboxForkFailure, Crypto.Crypto | Scope.Scope>
}

export class StrykerCliRunner extends Context.Service<StrykerCliRunner, StrykerCliRunnerShape>()(
  '@systemfsoftware/stryker-e2e/Harness/StrykerCliRunner',
) {
  static readonly layer = Layer.effect(
    StrykerCliRunner,
    Effect.sync(() => ({
      run: (
        args: ReadonlyArray<string>,
        warm: Warm.WarmSandbox,
        label: string,
        runEnvironment?: Readonly<Record<string, string>>,
      ) => runStrykerCli(args, warm, label, runEnvironment),
      streamRun: (
        args: ReadonlyArray<string>,
        warm: Warm.WarmSandbox,
        label: string,
        runEnvironment: Readonly<Record<string, string>> | undefined,
        interruptOnLine: (line: string, readGuestFile: Warm.GuestFileReader) => Promise<boolean>,
      ) => streamStrykerCli(args, warm, label, runEnvironment, interruptOnLine),
      guest: (
        argv: readonly [string, ...Array<string>],
        warm: Warm.WarmSandbox,
        label: string,
        runEnvironment?: Readonly<Record<string, string>>,
      ) => runGuestCommand(argv, warm, label, runEnvironment),
    })),
  )
}
