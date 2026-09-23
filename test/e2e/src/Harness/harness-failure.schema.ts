import { MicroVM } from '@systemfsoftware/effect-microsandbox'
import { Match, Schema } from 'effect'
import type { Config } from 'effect'
import type { PlatformError } from 'effect/PlatformError'

export class GuestJobFailure extends Schema.TaggedError<GuestJobFailure>()('GuestJobFailure', {
  step: Schema.String,
  cause: Schema.Union([
    MicroVM.VirtualizationUnsupportedError,
    MicroVM.SandboxBootError,
    MicroVM.WaitTimeoutError,
    MicroVM.ExecError,
    MicroVM.PortAllocationError,
    MicroVM.LoopbackViolationError,
  ]),
}) {
  override get message(): string {
    return Match.value(this.cause).pipe(
      Match.tag('VirtualizationUnsupportedError', (cause) => `${this.step}: ${cause._tag} — ${cause.remediation}`),
      Match.tag('SandboxBootError', (cause) => `${this.step}: ${cause._tag} while booting sandbox ${cause.sandboxName}`),
      Match.tag('WaitTimeoutError', (cause) => `${this.step}: ${cause._tag} waiting for ${cause.wait} within ${cause.timeoutMs}ms`),
      Match.tag('ExecError', (cause) => `${this.step}: ${cause._tag} running ${cause.argv.join(' ')}`),
      Match.tag('PortAllocationError', (cause) => `${this.step}: ${cause._tag} for guest port ${cause.guestPort}`),
      Match.tag('LoopbackViolationError', (cause) => `${this.step}: ${cause._tag} mapping guest port ${cause.guestPort} on ${cause.host}`),
      Match.exhaustive,
    )
  }
}

export class GuestSignaledFailure extends Schema.TaggedError<GuestSignaledFailure>()('GuestSignaledFailure', {
  step: Schema.String,
  memoryMiB: Schema.Number,
  stderrTail: Schema.String,
}) {
  override get message(): string {
    return `${this.step}: the guest workload was killed by a signal instead of exiting; check the ${this.memoryMiB} MiB guest memory limit first\n${this.stderrTail}`
  }
}

export class ExitFailure extends Schema.TaggedError<ExitFailure>()('ExitFailure', {
  step: Schema.String,
  exitCode: Schema.Number,
  stderrTail: Schema.String,
}) {
  override get message(): string {
    return `${this.step}: exited ${this.exitCode}\n${this.stderrTail}`
  }
}

export class FixtureMissingFailure extends Schema.TaggedError<FixtureMissingFailure>()('FixtureMissingFailure', {
  directory: Schema.String,
}) {
  override get message(): string {
    return `fixture directory does not exist on the host: ${this.directory}`
  }
}

export class PackFailure extends Schema.TaggedError<PackFailure>()('PackFailure', {
  step: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `${this.step}: ${this.detail}`
  }
}

export type HarnessFailure =
  | ExitFailure
  | FixtureMissingFailure
  | GuestJobFailure
  | GuestSignaledFailure
  | PackFailure

export type HarnessError = Config.ConfigError | HarnessFailure | PlatformError
