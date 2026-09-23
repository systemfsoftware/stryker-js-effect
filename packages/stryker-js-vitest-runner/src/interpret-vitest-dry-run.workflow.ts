import { Workflow } from '@systemfsoftware/effect-cell-types'
import { TestResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { VitestDryRunCommand } from './vitest-run-command.schema.js'

const VitestDryRunTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-vitest-runner/VitestDryRun')
type VitestDryRunTypeId = typeof VitestDryRunTypeId

export class DryRunComplete extends S.TaggedClass<DryRunComplete>()('Complete', {
  tests: S.Array(TestResultSchema),
}) {
  readonly [VitestDryRunTypeId] = VitestDryRunTypeId
}

export class DryRunExternalError extends S.TaggedClass<DryRunExternalError>()('Error', {
  tests: S.Array(TestResultSchema),
  errorMessage: S.String,
}) {
  readonly [VitestDryRunTypeId] = VitestDryRunTypeId
}

export type VitestDryRunOutcome = DryRunComplete | DryRunExternalError

const decideDryRun = (command: VitestDryRunCommand): VitestDryRunOutcome =>
  Boolean.match(command.tests.some((test) => test.status === 'failed'), {
    onTrue: (): VitestDryRunOutcome => DryRunComplete.make({ tests: command.tests }),
    onFalse: (): VitestDryRunOutcome =>
      Boolean.match(command.hasExternalError, {
        onTrue: (): VitestDryRunOutcome =>
          DryRunExternalError.make({
            tests: command.tests,
            errorMessage: `An error occurred outside of a test run: ${command.externalErrorText}`,
          }),
        onFalse: (): VitestDryRunOutcome => DryRunComplete.make({ tests: command.tests }),
      }),
  })

export const interpretVitestDryRun = Workflow.make({
  command: VitestDryRunCommand,
  decision: S.Union([DryRunComplete, DryRunExternalError]),
  error: S.Never,
  decide: (command) => Result.succeed(decideDryRun(command)),
})
