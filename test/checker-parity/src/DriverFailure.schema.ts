import * as S from 'effect/Schema'

export const DriverFailureCode = S.Literals([
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

export class DriverFailure extends S.TaggedError<DriverFailure>()('DriverFailure', {
  schemaVersion: S.Literal(1),
  code: DriverFailureCode,
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
