import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  planRunConclusion,
  PlanRunConclusionCommand,
  type PlanRunConclusionDecision,
  RunConclusionEmittedOk,
  RunConclusionFailed,
  RunConclusionQuietOk,
  RunConclusionVerdictFailed,
} from '../plan-run-conclusion.workflow.js'

const decisionOf = (
  subject: typeof planRunConclusion,
  command: PlanRunConclusionCommand,
): PlanRunConclusionDecision | undefined =>
  Result.match(subject(command), {
    onFailure: () => undefined,
    onSuccess: (decision) => decision,
  })

const sameRecord = (left: FailureRecord.FailureRecord, right: FailureRecord.FailureRecord): boolean =>
  S.toEquivalence(FailureRecord.FailureRecord)(left, right)

const concludesAsPlanned = (command: PlanRunConclusionCommand, decision: PlanRunConclusionDecision): boolean =>
  Match.value(command.decision).pipe(
    Match.tag(
      'RunOk',
      () => command.machine ? S.is(RunConclusionEmittedOk)(decision) : S.is(RunConclusionQuietOk)(decision),
    ),
    Match.tag(
      'RunVerdictFailed',
      (failed) => S.is(RunConclusionVerdictFailed)(decision) && decision.exitCode === failed.code,
    ),
    Match.tag('RunFailed', (failed) =>
      S.is(RunConclusionFailed)(decision) && decision.exitCode === failed.code &&
      sameRecord(decision.record, failed.record)),
    Match.exhaustive,
  )

describe('planRunConclusion', () => {
  it.prop(
    '∀command_Plan_≡AFailedRunConcludesWithItsRecordInEveryModeAndOnlyMachineModeEmitsSuccess',
    { of: [PlanRunConclusionCommand], subject: planRunConclusion },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      return decision !== undefined && concludesAsPlanned(command, decision)
    },
  )
})
