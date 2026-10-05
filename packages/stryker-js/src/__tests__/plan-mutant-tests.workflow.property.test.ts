import { describe, it } from '@systemfsoftware/vitest'

import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Report, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
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
  PlannedRunMutant,
} from '../plan-mutant-tests.workflow.js'

const MUTANT_TIMEOUT_FLOOR_MS = 100

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

const earlyResultReasonOf = (
  decision: PlannedEarlyResultMutant | PlannedRunMutant,
): string | undefined =>
  Option.getOrUndefined(
    Option.map(Option.liftPredicate(decision, S.is(PlannedEarlyResultMutant)), (early) => early.statusReason),
  )

const isRunPlan = (decision: PlannedEarlyResultMutant | PlannedRunMutant): boolean => S.is(PlannedRunMutant)(decision)

const isNoCoverageFilter = (filter: readonly string[] | undefined): boolean =>
  filter !== undefined && filter.length === 0

const isNoCoverageRunPlan = (decision: PlannedEarlyResultMutant | PlannedRunMutant): boolean =>
  S.is(PlannedRunMutant)(decision) && isNoCoverageFilter(decision.runOptions.testFilter)

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
    const mutantId = Mutant.MutantId.make('0000000000000000')
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

const timeByIdOf = (command: MutantTestPlanCommand, testId: string): number =>
  Option.getOrElse(Record.get(command.testTimeById, TestRunner.TestId.make(testId)), () => 0)

const killerOf = (command: MutantTestPlanCommand, mutantId: Mutant.MutantId): readonly TestRunner.TestId[] =>
  Option.getOrElse(
    Option.flatMap(
      Option.fromUndefinedOr(command.priorKilledByByMutantId),
      (byMutantId) => Record.get(byMutantId, mutantId),
    ),
    (): readonly TestRunner.TestId[] => [],
  )

const orderedCommandArb = Arbitrary.all([
  Arbitrary.schema(Mutant.Mutant),
  Arbitrary.array(Arbitrary.schema(TestRunner.TestId), { maxLength: 3 }),
  Arbitrary.array(Arbitrary.schema(Report.NonNegativeFinite), { maxLength: 3 }),
  Arbitrary.schema(S.Natural),
  Arbitrary.schema(S.Boolean),
]).pipe(
  Arbitrary.map(([baseMutant, coveringTests, durations, killerPick, hasKiller]) => {
    const mutantId = Mutant.MutantId.make('0000000000000000')
    const tests = [...new Set(coveringTests)]
    const testTimeById = Object.fromEntries(tests.map((testId, index) => [testId, durations[index] ?? 0]))
    const killer = hasKiller && tests.length > 0 ? tests[killerPick % tests.length] : undefined
    return MutantTestPlanCommand.make({
      _tag: 'MutantTestPlanCommand',
      mutants: [Mutant.Mutant.make({ ...baseMutant, id: mutantId, status: undefined, statusReason: undefined })],
      timeOverheadMS: 1,
      timeSpentAllTests: 1,
      hitsByMutantId: { [mutantId]: 1 },
      testsByMutantId: { [mutantId]: tests },
      testTimeById,
      staticCoverage: { [mutantId]: 0 },
      options: { coverageAnalysis: 'perTest', disableBail: false, timeoutMS: 0, timeoutFactor: 0, ignoreStatic: false },
      sandboxFileByName: {},
      ...(killer === undefined ? {} : { priorKilledByByMutantId: { [mutantId]: [killer] } }),
    })
  }),
)

const staticKillerCommandArb = Arbitrary.all([
  Arbitrary.schema(Mutant.Mutant),
  Arbitrary.array(Arbitrary.schema(TestRunner.TestId), { maxLength: 3 }),
  Arbitrary.array(Arbitrary.schema(S.Boolean), { maxLength: 3 }),
]).pipe(
  Arbitrary.map(([baseMutant, knownTests, killerFlags]) => {
    const mutantId = Mutant.MutantId.make('0000000000000000')
    const known = Arr.dedupe(knownTests)
    const killers = known.filter((_, index) => killerFlags[index] === true)
    return MutantTestPlanCommand.make({
      _tag: 'MutantTestPlanCommand',
      mutants: [Mutant.Mutant.make({ ...baseMutant, id: mutantId, status: undefined, statusReason: undefined })],
      timeOverheadMS: 1,
      timeSpentAllTests: 1,
      hitsByMutantId: { [mutantId]: 1 },
      testsByMutantId: { [mutantId]: [] },
      testTimeById: Object.fromEntries(known.map((testId) => [testId, 1])),
      staticCoverage: { [mutantId]: 1 },
      options: { coverageAnalysis: 'perTest', disableBail: false, timeoutMS: 0, timeoutFactor: 0, ignoreStatic: false },
      sandboxFileByName: {},
      ...(killers.length === 0 ? {} : { priorKilledByByMutantId: { [mutantId]: killers } }),
    })
  }),
)

const knownKillersOf = (command: MutantTestPlanCommand, mutantId: Mutant.MutantId): readonly TestRunner.TestId[] =>
  killerOf(command, mutantId).filter((testId) => Record.has(command.testTimeById, testId))

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
    '∀p_PerTestUncoveredNonStatic_≡NoCoverageRunPlan',
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
                  onTrue: () =>
                    isNoCoverageRunPlan(decision) &&
                    S.is(PlannedRunMutant)(decision) &&
                    decision.netTime === 0,
                }),
            })
          ),
      }),
  )

  it.prop(
    '∀r_RunPlan_≡AnEmptyTestFilterOnlyMarksAPerTestUncoveredMutant',
    { of: [MutantTestPlanCommand], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) => isNoCoverageRunPlan(decision) === isPerTestUncoveredNonStatic(command, mutant),
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
    '∀o_OrderedCoveringTests_≡ThePreviousKillerLeadsThenAscendingDryRunTime',
    { of: [orderedCommandArb], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) =>
                Option.match(Option.liftPredicate(decision, S.is(PlannedRunMutant)), {
                  onNone: () => true,
                  onSome: (run) => {
                    const filter = run.runOptions.testFilter ?? []
                    const tests = testsOf(command, mutant.id)
                    const killer = killerOf(command, mutant.id).find((testId) => tests.includes(testId))
                    const times = filter.map((testId) => timeByIdOf(command, testId))
                    const tail = killer === undefined ? times : times.slice(1)
                    return (
                      JSON.stringify([...filter].sort()) === JSON.stringify([...tests].sort()) &&
                      (killer === undefined || filter[0] === killer) &&
                      tail.every((time, tailIndex) => tail.slice(0, tailIndex).every((earlier) => earlier <= time))
                    )
                  },
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
                  onTrue: () =>
                    earlyResultStatusOf(decision) === 'Ignored' &&
                    earlyResultReasonOf(decision)?.startsWith('ignore-static') === true,
                }),
            })
          ),
      }),
  )

  it.prop(
    '∀r_IgnoredEarlyResult_≡ItsReasonIsForwardedOrNamesARule',
    { of: [coverageCommandArb], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            !S.is(PlannedEarlyResultMutant)(decision) || decision.status !== 'Ignored' ||
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) =>
                decision.statusReason === mutant.statusReason ||
                (decision.statusReason !== undefined && S.is(Mutant.IgnoreStatusReasonText)(decision.statusReason)),
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
    '∀p_CoveringTestTime_≡TheComputedTimeoutNeverFallsBelowTheFloor',
    { of: [MutantTestPlanCommand], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision) =>
            !S.is(PlannedRunMutant)(decision) || decision.runOptions.timeout >= MUTANT_TIMEOUT_FLOOR_MS
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

  it.prop(
    '∀s_StaticPriorKiller_≡TheRunPublishesItsKnownKillerTestIdsInTheirOrder',
    { of: [staticKillerCommandArb], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision, index) =>
            Option.match(Option.fromUndefinedOr(command.mutants[index]), {
              onNone: () => false,
              onSome: (mutant) =>
                Option.match(Option.liftPredicate(decision, S.is(PlannedRunMutant)), {
                  onNone: () => false,
                  onSome: (run) =>
                    run.runOptions.testFilter === undefined &&
                    JSON.stringify(run.runOptions.priorKillerTestIds ?? []) ===
                      JSON.stringify(knownKillersOf(command, mutant.id)),
                }),
            })
          ),
      }),
  )

  it.prop(
    '∀r_CoveredRun_≡NeverPublishesKillerTestIds',
    { of: [orderedCommandArb], subject: planMutantTests },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision) =>
            Option.match(Option.liftPredicate(decision, S.is(PlannedRunMutant)), {
              onNone: () => true,
              onSome: (run) =>
                run.runOptions.testFilter === undefined || run.runOptions.priorKillerTestIds === undefined,
            })
          ),
      }),
  )
})
