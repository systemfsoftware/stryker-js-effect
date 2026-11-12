import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class ErrorEnvelope extends S.Class<ErrorEnvelope, { readonly brand: unique symbol }>('ErrorEnvelope')({
  schemaVersion: RunEvent.StreamSchemaVersion,
  code: Plugin.ExitCode,
  error: S.NonEmptyString,
  remediation: S.NonEmptyString,
}) {
  get envelopeText(): string {
    return this.error
  }
}

export class RunExitCode extends S.Class<RunExitCode, { readonly brand: unique symbol }>('RunExitCode')({
  code: Plugin.ExitCode,
}) {}
