import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitCheckerAnswer,
  CheckerCommand,
  CheckerIgnoredWithoutRule,
  CheckGroupDecision,
  CheckResultDecision,
} from '../admit-checker-answer.workflow.js'

const isSafeKey = (id: string) => !Object.hasOwn(Object.prototype, id)

const commandArb = Arbitrary.schema(CheckerCommand).pipe(
  Arbitrary.filter((command) =>
    Object.keys(command.answers ?? {}).every(isSafeKey) &&
    (command.idGroups ?? []).flat().every(isSafeKey)
  ),
)

const requestedIdSetOf = (command: CheckerCommand): ReadonlySet<string> => new Set(command.requestedIds)

const submittedIdsOf = (command: CheckerCommand) =>
  command.phase === 'group' ? (command.idGroups ?? []).flat() : Object.keys(command.answers ?? {})

const unrequestedIdsOf = (command: CheckerCommand) => {
  const requested = requestedIdSetOf(command)
  return submittedIdsOf(command).filter((id) => !requested.has(id))
}

const missingIdsOf = (command: CheckerCommand) => {
  const submitted = new Set(submittedIdsOf(command))
  return command.requestedIds.filter((id) => !submitted.has(id))
}

const contractBreached = (command: CheckerCommand) =>
  unrequestedIdsOf(command).length > 0 || missingIdsOf(command).length > 0

const unadmittableIdsOf = (command: CheckerCommand) => {
  const requested = requestedIdSetOf(command)
  return command.phase === 'group' ? [] : Object.entries(command.answers ?? {})
    .filter(([id, answer]) => requested.has(id) && !S.is(Checker.CheckResultSchema)(answer))
    .map(([id]) => id)
}

const breached = (command: CheckerCommand) => contractBreached(command) || unadmittableIdsOf(command).length > 0

const expectedGroups = (command: CheckerCommand) => (command.idGroups ?? []).map((group) => [...group])

const expectedPairs = (command: CheckerCommand) => {
  const requested = requestedIdSetOf(command)
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

  it.prop(
    '∀i_IgnoredWithoutRule_≡RefusedNamingCheckerAndMutant',
    { of: [commandArb], subject: admitCheckerAnswer },
    (subject, [command]) =>
      Result.match(subject(command), {
        onSuccess: () => unadmittableIdsOf(command).length === 0,
        onFailure: (error) =>
          contractBreached(command) ||
          (S.is(CheckerIgnoredWithoutRule)(error) && error.checkerName === command.checkerName &&
            error.mutantId === unadmittableIdsOf(command)[0]),
      }),
  )
})
