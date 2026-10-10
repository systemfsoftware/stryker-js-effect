import * as S from 'effect/Schema'

export const ShellFailureCode = S.Literals([
  'usage-error',
  'refused-outside-ci',
  'shard-incomplete',
  'decode-failed',
  'worker-boot-failed',
  'telemetry-missing',
  'telemetry-version-unsupported',
  'rpc-failed',
  'io-failed',
])

export class ShellFailure extends S.TaggedError<ShellFailure>()('ShellFailure', {
  schemaVersion: S.Literal(1),
  code: ShellFailureCode,
  reason: S.String,
  nextAction: S.String,
}) {
  override get message(): string {
    return `${this.code}: ${this.reason}`
  }
}

export class ReportedExit extends S.TaggedError<ReportedExit>()('ReportedExit', {
  exitCode: S.Int,
}) {
  override get message(): string {
    return `checker-parity reported its outcome and exits ${this.exitCode}`
  }
}
