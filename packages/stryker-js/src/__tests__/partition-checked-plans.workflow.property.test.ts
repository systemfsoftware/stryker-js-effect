import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CheckedEntry } from '../../tests/__fixtures__/partition-checked-plans-law.schema.js'
import {
  CheckedPlanFailed,
  CheckedPlanPassed,
  partitionCheckedPlans,
  PartitionCheckedPlansCommand,
} from '../Checker/partition-checked-plans.workflow.js'

const commandOf = (entry: CheckedEntry): PartitionCheckedPlansCommand =>
  PartitionCheckedPlansCommand.make({ checked: [[entry.mutantId, entry.result]] })

const passedCheck = (result: Checker.CheckResult): Option.Option<Checker.PassedCheckResult> =>
  Option.liftPredicate(result, (candidate) => candidate.status === 'passed')

const failedCheck = (result: Checker.CheckResult): Option.Option<Checker.FailedCheckResult> =>
  Option.liftPredicate(result, (candidate) => candidate.status !== 'passed')

describe('partitionCheckedPlans', () => {
  it.prop(
    '∀e_CheckedPlan_≡DecidesOnePlanCarryingTheMutantId',
    { of: [CheckedEntry], subject: partitionCheckedPlans },
    (subject, [entry]) =>
      Result.match(subject(commandOf(entry)), {
        onFailure: () => false,
        onSuccess: (decisions) => decisions.length === 1 && decisions[0]?.mutantId === entry.mutantId,
      }),
  )

  it.prop(
    '∀e_PassedCheck_≡DecidesPassed',
    { of: [CheckedEntry], subject: partitionCheckedPlans },
    (subject, [entry]) =>
      Result.match(subject(commandOf(entry)), {
        onFailure: () => false,
        onSuccess: (decisions) =>
          Option.match(passedCheck(entry.result), {
            onNone: () => true,
            onSome: () =>
              Option.match(Option.fromUndefinedOr(decisions[0]), {
                onNone: () => false,
                onSome: (decision) => S.is(CheckedPlanPassed)(decision),
              }),
          }),
      }),
  )

  it.prop(
    '∀e_FailedCheck_≡DecidesFailedCarryingTheReason',
    { of: [CheckedEntry], subject: partitionCheckedPlans },
    (subject, [entry]) =>
      Result.match(subject(commandOf(entry)), {
        onFailure: () => false,
        onSuccess: (decisions) =>
          Option.match(failedCheck(entry.result), {
            onNone: () => true,
            onSome: (failed) =>
              Option.match(Option.fromUndefinedOr(decisions[0]), {
                onNone: () => false,
                onSome: (decision) => S.is(CheckedPlanFailed)(decision) && decision.reason === failed.reason,
              }),
          }),
      }),
  )
})
