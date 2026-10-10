import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class ErrorEnvelope extends S.Class<ErrorEnvelope>('ErrorEnvelope')({
  schemaVersion: RunEvent.StreamSchemaVersion,
  code: Plugin.ExitCode,
  error: S.NonEmptyString,
  remediation: S.NonEmptyString,
}) {
  get envelopeText(): string {
    return this.error
  }
}

export class RunExitCode extends S.Class<RunExitCode>('RunExitCode')({
  code: Plugin.ExitCode,
}) {}
