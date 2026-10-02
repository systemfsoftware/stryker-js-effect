import type { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'

import type { RunOutcomeDecision } from '../classify-run-outcome.workflow.js'
import { RunExitCode } from './run-failure.schema.js'

export const exitCodeOf = (outcome: RunOutcomeDecision): Plugin.ExitCode =>
  Match.value(outcome).pipe(
    Match.tag('RunOk', () => 0),
    Match.tag('RunVerdictFailed', (failed) => failed.code),
    Match.tag('RunFailed', (failed) => failed.code),
    Match.exhaustive,
  )

export const runExitCodeFromOutcome = (outcome: RunOutcomeDecision): RunExitCode =>
  RunExitCode.make({ code: exitCodeOf(outcome) })
