import { describe, it } from '@systemfsoftware/vitest'

import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { MutantTestPlanCommand } from '../MutantTestPlanCommand.schema.js'
import {
  CoveredMutantHitCountMissing,
  MutantTimeoutNotFinite,
  planMutantTests,
  PlannedEarlyResultMutant,
  PlannedRunMutant,
} from '../plan-mutant-tests.workflow.js'

const testsOf = (command: MutantTestPlanCommand, id: Mutant.MutantId): readonly TestRunner.TestId[] =>
  Option.getOrElse(Record.get(command.testsByMutantId, id), (): readonly TestRunner.TestId[] => [])

const staticCountOf = (command: MutantTestPlanCommand, id: Mutant.MutantId): number =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(command.staticCoverage), (coverage) => Record.get(coverage, id)),
    () => 0,
  )

const isUncoveredNonStaticMutant = (command: MutantTestPlanCommand, mutant: Mutant.Mutant): boolean =>
  staticCountOf(command, mutant.id) === 0 &&
  mutant.status === undefined &&
  testsOf(command, mutant.id).length === 0

const isPerTestUncoveredNonStatic = (command: MutantTestPlanCommand, mutant: Mutant.Mutant): boolean =>
  command.options.coverageAnalysis === 'perTest' && isUncoveredNonStaticMutant(command, mutant)

const isUncoveredStatic = (command: MutantTestPlanCommand, mutant: Mutant.Mutant): boolean =>
  command.staticCoverage !== undefined &&
  staticCountOf(command, mutant.id) > 0 &&
  mutant.status === undefined &&
  testsOf(command, mutant.id).length === 0

const isOtherModeUncoveredNonStatic = (command: MutantTestPlanCommand, mutant: Mutant.Mutant): boolean =>
  command.options.coverageAnalysis !== 'perTest' && isUncoveredNonStaticMutant(command, mutant)

const isPerTestCoveredNonStatic = (command: MutantTestPlanCommand, mutant: Mutant.Mutant): boolean =>
  command.options.coverageAnalysis === 'perTest' &&
  command.staticCoverage !== undefined &&
  staticCountOf(command, mutant.id) === 0 &&
  mutant.status === undefined &&
  testsOf(command, mutant.id).length > 0

const earlyResultStatusOf = (
  decision: PlannedEarlyResultMutant | PlannedRunMutant,
): Mutant.MutantStatus | undefined =>
  Option.getOrUndefined(
    Option.map(Option.liftPredicate(decision, S.is(PlannedEarlyResultMutant)), (early) => early.status),
  )

const isRunPlan = (decision: PlannedEarlyResultMutant | PlannedRunMutant): boolean => S.is(PlannedRunMutant)(decision)

const coverageCommandArb = Arbitrary.all([
  Arbitrary.schema(Mutant.Mutant),
  Arbitrary.schema(S.Literals(['off', 'all', 'perTest'])),
  Arbitrary.schema(S.Boolean),
  Arbitrary.schema(S.Boolean),
  Arbitrary.schema(S.Boolean),
  Arbitrary.array(Arbitrary.schema(TestRunner.TestId), { maxLength: 2 }),
  Arbitrary.schema(S.Boolean),
]).pipe(
  Arbitrary.map(([baseMutant, coverageAnalysis, ignoreStatic, isStatic, staticPresent, coveringTests, closed]) => {
    const mutantId = Mutant.MutantId.make('0')
    return MutantTestPlanCommand.make({
      _tag: 'MutantTestPlanCommand',
      mutants: [
        Mutant.Mutant.make({
          ...baseMutant,
          id: mutantId,
          status: closed ? 'Ignored' : undefined,
          statusReason: undefined,
        }),
      ],
      timeOverheadMS: 1,
      timeSpentAllTests: 1,
      hitsByMutantId: { [mutantId]: 1 },
      testsByMutantId: { [mutantId]: [...coveringTests] },
      testTimeById: Object.fromEntries(coveringTests.map((testId) => [testId, 1])),
      ...(staticPresent ? { staticCoverage: { [mutantId]: isStatic ? 1 : 0 } } : {}),
      options: { coverageAnalysis, disableBail: false, timeoutMS: 0, timeoutFactor: 0, ignoreStatic },
      sandboxFileByName: {},
    })
  }),
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

  it.prop(
    '∀p_PerTestUncoveredNonStatic_≡NoCoverageEarlyResult',
    { of: [MutantTestPlanCommand], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) =>
                Boolean.match(isPerTestUncoveredNonStatic(command, mutant), {
                  onFalse: () => true,
                  onTrue: () => earlyResultStatusOf(decision) === 'NoCoverage',
                }),
            })
          ),
      }),
  )

  it.prop(
    '∀s_PerTestUncoveredStatic_≡RunPlan',
    { of: [coverageCommandArb], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) =>
                Boolean.match(
                  command.options.coverageAnalysis === 'perTest' &&
                    !command.options.ignoreStatic &&
                    isUncoveredStatic(command, mutant),
                  {
                    onFalse: () => true,
                    onTrue: () => isRunPlan(decision),
                  },
                ),
            })
          ),
      }),
  )

  it.prop(
    '∀o_OtherModeUncoveredNonStatic_≡RunPlan',
    { of: [MutantTestPlanCommand], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) =>
                Boolean.match(isOtherModeUncoveredNonStatic(command, mutant), {
                  onFalse: () => true,
                  onTrue: () => isRunPlan(decision),
                }),
            })
          ),
      }),
  )

  it.prop(
    '∀v_PerTestCoveredNonStatic_≡RunPlanOverCoveringTests',
    { of: [coverageCommandArb], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) =>
                Boolean.match(isPerTestCoveredNonStatic(command, mutant), {
                  onFalse: () => true,
                  onTrue: () =>
                    Option.match(Option.liftPredicate(decision, S.is(PlannedRunMutant)), {
                      onNone: () => false,
                      onSome: (run) =>
                        JSON.stringify(run.runOptions.testFilter ?? []) === JSON.stringify(testsOf(command, mutant.id)),
                    }),
                }),
            })
          ),
      }),
  )

  it.prop(
    '∀i_IgnoreStaticUncoveredStatic_≡Ignored',
    { of: [coverageCommandArb], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) =>
                Boolean.match(command.options.ignoreStatic && isUncoveredStatic(command, mutant), {
                  onFalse: () => true,
                  onTrue: () => earlyResultStatusOf(decision) === 'Ignored',
                }),
            })
          ),
      }),
  )

  it.prop(
    '∀l_ClosedMutant_≡KeepsItsStatus',
    { of: [MutantTestPlanCommand], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) => mutant.status === undefined || earlyResultStatusOf(decision) === mutant.status,
            })
          ),
      }),
  )

  it.prop(
    '∀x_Plan_≡ExactlyOnePartition',
    { of: [MutantTestPlanCommand], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.length === command.mutants.length &&
          decisions.every((decision) => S.is(PlannedEarlyResultMutant)(decision) !== S.is(PlannedRunMutant)(decision)),
      }),
  )
})
