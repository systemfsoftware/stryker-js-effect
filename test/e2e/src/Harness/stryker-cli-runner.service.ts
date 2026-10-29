import { type Config, Context, type Effect } from 'effect'
import type { Scope } from 'effect'
import type * as SecureRandom from 'effect/crypto/SecureRandom'

import type { ExecResult } from './guest-job.schema.js'
import type { SandboxForkFailure } from './harness-failure.schema.js'
import type * as Warm from './warm-sandbox.handle.js'

export interface ForkedRun {
  readonly result: ExecResult
  readonly fork: Warm.SandboxFork
}

export interface ForkedStreamedRun {
  readonly result: Warm.StreamedExecResult
  readonly fork: Warm.SandboxFork
}

export interface StrykerCliRunnerShape {
  readonly run: (
    args: ReadonlyArray<string>,
    warm: Warm.WarmSandbox,
    label: string,
    runEnvironment?: Readonly<Record<string, string>> | undefined,
  ) => Effect.Effect<ForkedRun, Config.ConfigError | SandboxForkFailure, SecureRandom.SecureRandom | Scope.Scope>
  readonly streamRun: (
    args: ReadonlyArray<string>,
    warm: Warm.WarmSandbox,
    label: string,
    runEnvironment: Readonly<Record<string, string>> | undefined,
    interruptOnLine: (line: string, readGuestFile: Warm.GuestFileReader) => Promise<boolean>,
  ) => Effect.Effect<
    ForkedStreamedRun,
    Config.ConfigError | SandboxForkFailure,
    SecureRandom.SecureRandom | Scope.Scope
  >
}

export class StrykerCliRunner extends Context.Service<StrykerCliRunner, StrykerCliRunnerShape>()(
  '@systemfsoftware/stryker-e2e/Harness/StrykerCliRunner',
) {}
