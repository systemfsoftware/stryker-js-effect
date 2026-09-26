import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export class RunOutcomeCommand extends S.TaggedClass<RunOutcomeCommand>()('RunOutcomeCommand', {
  succeeded: S.Boolean,
  interrupted: S.Boolean,
  helpErrorCount: S.optional(S.Finite),
  cliError: S.Boolean,
  unrecognized: S.optional(S.String),
  survivorsReason: S.optional(S.Literals(['no-report', 'mismatch'])),
  survivorsDiagnostic: S.optional(S.String),
  schemaError: S.Boolean,
  successExitClass: S.optional(Plugin.ExitClass),
  highestExitClass: S.optional(Plugin.ExitClass),
  configDetail: S.optional(S.String),
  diagnostic: S.optional(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    succeeded: 'stryker.run_outcome.succeeded',
    interrupted: 'stryker.run_outcome.interrupted',
    helpErrorCount: 'stryker.run_outcome.help_error_count',
    cliError: 'stryker.run_outcome.cli_error',
    survivorsReason: 'stryker.run_outcome.survivors_reason',
    schemaError: 'stryker.run_outcome.schema_error',
    successExitClass: 'stryker.run_outcome.success_exit_class',
    highestExitClass: 'stryker.run_outcome.highest_exit_class',
  } as const
}
