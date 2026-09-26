import { describe, it } from '@systemfsoftware/vitest'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { MutantTestPlanCommand } from '../MutantTestPlanCommand.schema.js'
import {
  CoveredMutantHitCountMissing,
  MutantTimeoutNotFinite,
  planMutantTests,
  PlannedEarlyResultMutant,
} from '../plan-mutant-tests.workflow.js'

const testsOf = (command: MutantTestPlanCommand, id: Mutant.MutantId): readonly TestRunner.TestId[] =>
  Option.getOrElse(Record.get(command.testsByMutantId, id), (): readonly TestRunner.TestId[] => [])

const staticCountOf = (command: MutantTestPlanCommand, id: Mutant.MutantId): number =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(command.staticCoverage), (coverage) => Record.get(coverage, id)),
    () => 0,
  )

describe('planMutantTests', () => {
  it.prop(
    '∀m_Command_≡OrdersOutcomesByMutantOrder',
    { of: [MutantTestPlanCommand], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.length === command.mutants.length &&
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) => decision.mutantId === mutant.id,
            })
          ),
      }),
  )

  it.prop(
    '∀c_ClosedMutant_≡DecidesEarlyResult',
    { of: [MutantTestPlanCommand], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) => mutant.status === undefined || S.is(PlannedEarlyResultMutant)(decision),
            })
          ),
      }),
  )

  it.prop(
    '∀f_Refusal_≡FailingPlansNameTheMutantTheyRefuse',
    { of: [MutantTestPlanCommand], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: (failure) =>
          S.is(CoveredMutantHitCountMissing)(failure)
            ? failure.missingIds.length > 0
            : S.is(MutantTimeoutNotFinite)(failure),
        onSuccess: () => true,
      }),
  )

  it.prop(
    '∀u_EarlyOutcomes_≡CarryStaticAndCoveredBy',
    { of: [MutantTestPlanCommand], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.liftPredicate(decision, S.is(PlannedEarlyResultMutant)), {
              onNone: () => true,
              onSome: (early) =>
                Option.match(Option.fromUndefinedOr(command.mutants[index]), {
                  onNone: () => false,
                  onSome: (mutant) => {
                    const expectedCoveredBy = Option.match(Option.fromUndefinedOr(mutant.status), {
                      onNone: () => testsOf(command, early.mutantId),
                      onSome: () => mutant.coveredBy,
                    })
                    return early.static === (staticCountOf(command, early.mutantId) > 0) &&
                      JSON.stringify(early.coveredBy) === JSON.stringify(expectedCoveredBy)
                  },
                }),
            })
          ),
      }),
  )
})
