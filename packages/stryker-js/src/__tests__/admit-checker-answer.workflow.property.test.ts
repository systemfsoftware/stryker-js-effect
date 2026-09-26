import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  admitCheckerAnswer,
  CheckerCommand,
  CheckGroupDecision,
  CheckResultDecision,
} from '../admit-checker-answer.workflow.js'

const isSafeKey = (id: string) => !Object.hasOwn(Object.prototype, id)

const commandArb = Arbitrary.schema(CheckerCommand).pipe(
  Arbitrary.filter((command) =>
    command.requestedIds.every(isSafeKey) &&
    Object.keys(command.answers ?? {}).every(isSafeKey) &&
    (command.idGroups ?? []).flat().every(isSafeKey)
  ),
)

const submittedIdsOf = (command: CheckerCommand) =>
  command.phase === 'group' ? (command.idGroups ?? []).flat() : Object.keys(command.answers ?? {})

const unrequestedIdsOf = (command: CheckerCommand) =>
  submittedIdsOf(command).filter((id) => !command.requestedIds.includes(id))

const missingIdsOf = (command: CheckerCommand) =>
  command.requestedIds.filter((id) => !submittedIdsOf(command).includes(id))

const breached = (command: CheckerCommand) => unrequestedIdsOf(command).length > 0 || missingIdsOf(command).length > 0

const expectedGroups = (command: CheckerCommand) => (command.idGroups ?? []).map((group) => [...group])

const expectedPairs = (command: CheckerCommand) => {
  const requested = new Set(command.requestedIds)
  return Object.entries(command.answers ?? {})
    .filter(([id]) => requested.has(id))
    .map(([id, result]) => ({ id, result }))
}

describe('admitCheckerAnswer', () => {
  it.prop(
    '∀c_ContractBreach_≡Failure',
    { of: [commandArb], subject: admitCheckerAnswer },
    (subject, [command]) => {
      const result = subject(command)
      return breached(command) ? Result.isFailure(result) : Result.isSuccess(result)
    },
  )

  it.prop(
    '∀g_GroupPhase_≡DecisionReturnsRequestedGroups',
    { of: [commandArb], subject: admitCheckerAnswer },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decision) =>
          command.phase !== 'group' ||
          (S.is(CheckGroupDecision)(decision) &&
            JSON.stringify(decision.groups) === JSON.stringify(expectedGroups(command))),
      }),
  )

  it.prop(
    '∀r_CheckPhase_≡DecisionPairsAnswersById',
    { of: [commandArb], subject: admitCheckerAnswer },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decision) =>
          command.phase !== 'check' ||
          (S.is(CheckResultDecision)(decision) &&
            JSON.stringify(decision.pairs) === JSON.stringify(expectedPairs(command))),
      }),
  )
})
