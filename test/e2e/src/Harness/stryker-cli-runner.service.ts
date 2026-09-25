import type { Readiness } from '@systemfsoftware/effect-readiness'
import { Config, Context, Effect, Layer, Option } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as FileSystem from 'effect/FileSystem'

import type { ExecResult } from './guest-job.schema.js'
import { GuestJobs } from './guest-job.service.js'
import type { HarnessError } from './harness-failure.schema.js'
import { seamSpan, SpanNames } from './harness-telemetry.service.js'

const RUN_CLI_STEP = 'run the stryker CLI in its microVM'

const guestTelemetryEnvironment = (env: {
  readonly OTEL_ENABLED?: string | undefined
  readonly OTEL_SERVICE_NAME?: string | undefined
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string | undefined
}) => ({
  OTEL_ENABLED: env['OTEL_ENABLED'] ?? 'false',
  OTEL_SERVICE_NAME: env['OTEL_SERVICE_NAME'] ?? 'stryker-e2e',
  OTEL_EXPORTER_OTLP_ENDPOINT: (env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://127.0.0.1:4318')
    .replace('127.0.0.1', 'host.microsandbox.internal')
    .replace('localhost', 'host.microsandbox.internal'),
})

const runStrykerCli = (args: ReadonlyArray<string>, cwd: string) =>
  Effect.gen(function*() {
    const jobs = yield* GuestJobs
    const enabled = yield* Config.option(Config.String('OTEL_ENABLED'))
    const service = yield* Config.option(Config.String('OTEL_SERVICE_NAME'))
    const endpoint = yield* Config.option(Config.String('OTEL_EXPORTER_OTLP_ENDPOINT'))
    const completion = yield* jobs.runGuestJob(
      RUN_CLI_STEP,
      jobs.job(['npx', '--no-install', 'stryker', ...args], [{ host: cwd, guest: GuestJobs.GUEST_WORKROOT }])
        .withWorkdir(GuestJobs.GUEST_WORKROOT)
        .withEnv(guestTelemetryEnvironment({
          OTEL_ENABLED: Option.getOrUndefined(enabled),
          OTEL_SERVICE_NAME: Option.getOrUndefined(service),
          OTEL_EXPORTER_OTLP_ENDPOINT: Option.getOrUndefined(endpoint),
        }))
        .withHostAccess(true),
    )
    const exitCode = yield* jobs.requireExited(RUN_CLI_STEP, completion)
    return {
      exitCode,
      stdout: new TextDecoder().decode(completion.stdout),
      stderr: new TextDecoder().decode(completion.stderr),
    }
  }).pipe(seamSpan(SpanNames.cliRun, { 'e2e.cli.args': args.join(' ') }))

export interface StrykerCliRunnerShape {
  readonly run: (
    args: ReadonlyArray<string>,
    cwd: string,
  ) => Effect.Effect<ExecResult, HarnessError, GuestJobs | Crypto.Crypto | FileSystem.FileSystem | Readiness.HostProber>
}

export class StrykerCliRunner extends Context.Service<StrykerCliRunner, StrykerCliRunnerShape>()(
  '@systemfsoftware/stryker-e2e/Harness/StrykerCliRunner',
) {
  static readonly layer = Layer.effect(
    StrykerCliRunner,
    Effect.sync(() => ({
      run: (args: ReadonlyArray<string>, cwd: string) => runStrykerCli(args, cwd),
    })),
  )
}
