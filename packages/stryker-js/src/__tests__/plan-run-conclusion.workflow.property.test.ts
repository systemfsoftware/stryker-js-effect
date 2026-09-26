import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  planRunConclusion,
  PlanRunConclusionCommand,
  type PlanRunConclusionDecision,
  RunConclusionEmittedFailed,
  RunConclusionEmittedOk,
  RunConclusionQuietFailed,
  RunConclusionQuietOk,
} from '../plan-run-conclusion.workflow.js'

type ConclusionVariant = 'emitted-ok' | 'emitted-failed' | 'quiet-ok' | 'quiet-failed'

const variantOf = (machine: boolean, exitCode: number): ConclusionVariant =>
  machine
    ? (exitCode === 0 ? 'emitted-ok' : 'emitted-failed')
    : (exitCode === 0 ? 'quiet-ok' : 'quiet-failed')

const isVariant = (variant: ConclusionVariant, decision: PlanRunConclusionDecision): boolean =>
  Match.value(variant).pipe(
    Match.when('emitted-ok', () => S.is(RunConclusionEmittedOk)(decision)),
    Match.when('emitted-failed', () => S.is(RunConclusionEmittedFailed)(decision)),
    Match.when('quiet-ok', () => S.is(RunConclusionQuietOk)(decision)),
    Match.when('quiet-failed', () => S.is(RunConclusionQuietFailed)(decision)),
    Match.exhaustive,
  )

const decisionOf = (
  subject: typeof planRunConclusion,
  command: PlanRunConclusionCommand,
): PlanRunConclusionDecision | undefined =>
  Result.match(subject(command), {
    onFailure: () => undefined,
    onSuccess: (decision) => decision,
  })

const commandCarried = (command: PlanRunConclusionCommand, decision: PlanRunConclusionDecision): boolean =>
  Match.value(variantOf(command.machine, command.exitCode)).pipe(
    Match.when(
      'emitted-ok',
      () => S.is(RunConclusionEmittedOk)(decision) && Equal.equals(decision.command, command.command),
    ),
    Match.when('emitted-failed', () =>
      S.is(RunConclusionEmittedFailed)(decision) &&
      Equal.equals(decision.command, command.command) &&
      decision.exitCode === command.exitCode),
    Match.when('quiet-ok', () => S.is(RunConclusionQuietOk)(decision)),
    Match.when(
      'quiet-failed',
      () => S.is(RunConclusionQuietFailed)(decision) && decision.exitCode === command.exitCode,
    ),
    Match.exhaustive,
  )

describe('planRunConclusion', () => {
  it.prop(
    '∀command_Plan_≡VariantAndEffectFollowMachineAndExitCode',
    { of: [PlanRunConclusionCommand], subject: planRunConclusion },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      return decision !== undefined &&
        isVariant(variantOf(command.machine, command.exitCode), decision) &&
        commandCarried(command, decision)
    },
  )

  it.prop(
    '∀machine_Plan_≡ZeroExitIsOk',
    { of: [S.Boolean], subject: planRunConclusion },
    (subject, [machine]) => {
      const command = PlanRunConclusionCommand.make({
        command: {
          _tag: 'RunOutcomeCommand',
          succeeded: true,
          interrupted: false,
          cliError: false,
          schemaError: false,
        },
        machine,
        exitCode: 0,
        outcome: 'RunOk',
        error: '',
      })
      const decision = decisionOf(subject, command)
      return decision !== undefined &&
        Match.value(machine).pipe(
          Match.when(true, () => S.is(RunConclusionEmittedOk)(decision)),
          Match.when(false, () => S.is(RunConclusionQuietOk)(decision)),
          Match.exhaustive,
        )
    },
  )
})
