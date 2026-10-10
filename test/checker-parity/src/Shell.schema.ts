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

export class ParityViolated extends S.TaggedError<ParityViolated>()('ParityViolated', {
  violations: S.Int,
}) {
  override get message(): string {
    return `checker parity broke with ${this.violations} violation(s)`
  }
}
