import { describe, it } from '@effect/vitest'
import { pathToFileURL } from 'node:url'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Array from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  MutantTestPlanCommand,
  PlannedEarlyResultMutant,
  PlannedRunMutant,
  planMutantTests,
} from '../plan-mutant-tests.workflow.js'

const PlanDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantPlan')

const BASELINE_MUTANTS = '/tmp/refactor/baseline/packages/stryker-js/src/Mutants.ts'

const loadBaselinePlanner = () =>
  import(pathToFileURL(BASELINE_MUTANTS).href) as Promise<{
    readonly planMutantTests: (command: unknown) => {
      readonly plans: ReadonlyArray<{
        readonly plan: 'Run' | 'EarlyResult'
        readonly mutantId: string
        readonly netTime?: number
        readonly runOptions?: Record<string, unknown>
        readonly status?: string
        readonly statusReason?: string | undefined
        readonly static?: boolean | undefined
        readonly coveredBy?: ReadonlyArray<string> | undefined
      }>
    }
    readonly missingHitCountIds: (command: unknown) => ReadonlyArray<string>
  }>

const mutantArb = Arbitrary.schema(Mutant)

const smallNonNegativeArb = Arbitrary.schema(
  S.Finite.check(S.compose(S.isGreaterThanOrEqualTo(0), S.isLessThanOrEqualTo(1000))),
).pipe(
  Arbitrary.filter((count) => Number.isInteger(count) && count >= 0),
)

const scenarioArb = Arbitrary.schema(S.Array(Mutant).check(S.isMinLength(1))).pipe(
  Arbitrary.filter((mutants) => new Set(mutants.map((mutant) => mutant.id)).size === mutants.length),
  Arbitrary.flatMap((mutants) =>
    Arbitrary.all(
      mutants.map((mutant) =>
        Arbitrary.all([smallNonNegativeArb, Arbitrary.schema(S.Boolean), Arbitrary.schema(S.Boolean)]).pipe(
          Arbitrary.map(([hitCount, isCovered, isStatic]) => ({ mutant, hitCount, isCovered, isStatic })),
        )),
    ).pipe(
      Arbitrary.flatMap((perMutant) =>
        Arbitrary.all([Arbitrary.schema(S.Boolean), Arbitrary.schema(S.Boolean), smallNonNegativeArb]).pipe(
          Arbitrary.map(([ignoreStatic, disableBail, timeOverheadMS]) => {
            const hitsByMutantId = Object.fromEntries(
              perMutant
                .filter((entry) => entry.isCovered)
                .map((entry) => [entry.mutant.id, entry.hitCount] as const),
            )
            const coveredByTests = Object.fromEntries(
              perMutant.filter((entry) => entry.isCovered).map((entry) => [entry.mutant.id, [`test-${entry.mutant.id}`]]),
            )
            const testTimeById = Object.fromEntries(
              perMutant.filter((entry) => entry.isCovered).map((entry) => [`test-${entry.mutant.id}`, 7] as const),
            )
            const staticCoverage = Object.fromEntries(
              perMutant.filter((entry) => entry.isStatic).map((entry) => [entry.mutant.id, 2] as const),
            )
            return MutantTestPlanCommand.make({
              mutants: [...mutants],
              timeOverheadMS,
              timeSpentAllTests: 42,
              hitsByMutantId,
              staticCoverage: Object.keys(staticCoverage).length === 0 ? undefined : staticCoverage,
              testsByMutantId: coveredByTests,
              testTimeById,
              options: { disableBail, timeoutMS: 2000, timeoutFactor: 1.5, ignoreStatic },
              sandboxFileByName: {},
            })
          }),
        ),
      ),
    ),
  ),
)

type PlainExpected = {
  readonly plan: 'Run' | 'EarlyResult'
  readonly mutantId: string
  readonly netTime?: number
  readonly runOptions?: Record<string, unknown>
  readonly status?: string
  readonly statusReason?: string | undefined
  readonly static?: boolean | undefined
  readonly coveredBy?: ReadonlyArray<string> | undefined
}

const plainOf = (decision: PlannedRunMutant | PlannedEarlyResultMutant): PlainExpected =>
  decision._tag === 'PlannedRunMutant'
    ? {
      plan: 'Run',
      mutantId: decision.mutantId,
      netTime: decision.netTime,
      runOptions: { ...decision.runOptions },
      static: decision.static,
      coveredBy: decision.coveredBy,
    }
    : {
      plan: 'EarlyResult',
      mutantId: decision.mutantId,
      status: decision.status,
      statusReason: decision.statusReason,
      static: decision.static,
      coveredBy: decision.coveredBy,
    }

const plansEqual = (actual: PlainExpected, expected: PlainExpected) => {
  const actualRows = Object.fromEntries(Object.entries(actual).filter(([, value]) => value !== undefined))
  const expectedRows = Object.fromEntries(Object.entries(expected).filter(([, value]) => value !== undefined))
  return JSON.stringify(actualRows) === JSON.stringify(expectedRows)
}

const IgnoredStaticReason = 'Static mutant (and "ignoreStatic" was enabled)'

describe('planMutantTests', () => {
  it.prop('forall_d_DecisionBrand_present', [S.Union([PlannedRunMutant, PlannedEarlyResultMutant])], ([decision]) =>
    Object.getOwnPropertySymbols(decision).includes(PlanDecisionTypeId))

  it.prop('forall_m_Command_ordersOutcomesByMutantOrder', [scenarioArb], ([command]) => {
    const result = planMutantTests(command)
    if (!Result.isSuccess(result)) {
      return false
    }
    return (
      result.success.length === command.mutants.length &&
      result.success.every((decision, index) => decision.mutantId === command.mutants[index]?.id)
    )
  })

  it.prop('forall_c_ClosedMutant_decidesEarlyResult', [scenarioArb], ([command]) => {
    const result = planMutantTests(command)
    if (!Result.isSuccess(result)) {
      return false
    }
    return result.success.every((decision) => {
      const mutant = command.mutants.find((candidate) => candidate.id === decision.mutantId)
      return mutant?.status === undefined || S.is(PlannedEarlyResultMutant)(decision)
    })
  })

  it.prop('forall_s_StaticMutantWithCoveredTests_decidesIgnored', [scenarioArb], ([command]) => {
    const mutated = MutantTestPlanCommand.make({ ...command, options: { ...command.options, ignoreStatic: true } })
    const result = planMutantTests(mutated)
    if (!Result.isSuccess(result)) {
      return false
    }
    return result.success.every((decision) => {
      const mutant = mutated.mutants.find((candidate) => candidate.id === decision.mutantId)
      const tests = mutated.testsByMutantId[decision.mutantId] ?? []
      const isStatic = (mutated.staticCoverage?.[decision.mutantId] ?? 0) > 0
      return Boolean.match(isStatic && tests.length === 0 && mutant?.status === undefined, {
        onTrue: () =>
          S.is(PlannedEarlyResultMutant)(decision) &&
          decision.status === 'Ignored' &&
          decision.statusReason === IgnoredStaticReason,
        onFalse: () => true,
      })
    })
  })

  it.prop('forall_t_CoveredTestTime_conservesNetTime', [scenarioArb], ([command]) => {
    const result = planMutantTests(command)
    if (!Result.isSuccess(result)) {
      return false
    }
    return result.success.every((decision) => {
      if (!S.is(PlannedRunMutant)(decision)) {
        return true
      }
      const testIds = command.testsByMutantId[decision.mutantId] ?? []
      const netTime = testIds.reduce((acc, id) => acc + (command.testTimeById[id] ?? 0), 0)
      const isStatic = (command.staticCoverage?.[decision.mutantId] ?? 0) > 0
      const covered = testIds.length > 0 || (command.staticCoverage !== undefined && isStatic)
      return Boolean.match(covered && testIds.length > 0 && decision.runOptions.testFilter !== undefined, {
        onTrue: () => decision.netTime === netTime,
        onFalse: () => true,
      })
    })
  })

  it.prop(
    'forall_h_HitLimit_conservesHundredfold',
    [scenarioArb],
    ([command]) =>
      Result.match(planMutantTests(command), {
        onFailure: () => true,
        onSuccess: (decisions) =>
          decisions.every((decision) =>
            Boolean.match(S.is(PlannedRunMutant)(decision), {
              onTrue: () => {
                const expected = command.hitsByMutantId[decision.mutantId]
                return expected === undefined
                  ? decision.runOptions.hitLimit === undefined
                  : decision.runOptions.hitLimit === expected * 100
              },
              onFalse: () => true,
            })),
      }),
  )

  it.prop('forall_o_Oracle_matchesBaselinePlanner', [scenarioArb], async ([command]) => {
    const baseline = await loadBaselinePlanner()
    const expected = baseline.planMutantTests(JSON.parse(JSON.stringify(command)))
    const actual = planMutantTests(command)
    const missing = baseline.missingHitCountIds(JSON.parse(JSON.stringify(command)))
    return Boolean.match(missing.length > 0, {
      onTrue: () =>
        Result.isFailure(actual) &&
        actual.failure.stage === 'mutationTest' &&
        actual.failure.reason === `covered mutant missing dry-run hit count: ${missing.join(', ')}`,
      onFalse: () =>
        Result.isSuccess(actual) &&
        actual.success.length === expected.plans.length &&
        actual.success.every((decision, index) => {
          const expectedPlan = expected.plans[index]
          return expectedPlan !== undefined && plansEqual(plainOf(decision), expectedPlan)
        }),
    })
  })
})

describe('planMutantTests sequential invariants', () => {
  it.prop('forall_u_UncoveredEarlyOutcomes_carryStaticAndCoveredBy', [scenarioArb], ([command]) => {
    const result = planMutantTests(command)
    return Boolean.match(Result.isSuccess(result), {
      onTrue: () =>
        result.success.every((decision) => {
          if (!S.is(PlannedEarlyResultMutant)(decision)) {
            return true
          }
          const isStatic = (command.staticCoverage?.[decision.mutantId] ?? 0) > 0
          return (
            decision.static === (isStatic ? true : undefined) &&
            JSON.stringify(decision.coveredBy ?? []) ===
              JSON.stringify(command.testsByMutantId[decision.mutantId] ?? [])
          )
        }),
      onFalse: () => true,
    })
  })

  it.prop('forall_r_RunOutcomes_carryMaterializationFields', [scenarioArb], ([command]) => {
    const result = planMutantTests(command)
    return Boolean.match(Result.isSuccess(result), {
      onTrue: () =>
        result.success.every((decision) => {
          if (!S.is(PlannedRunMutant)(decision)) {
            return true
          }
          const tests = command.testsByMutantId[decision.mutantId] ?? []
          const isStatic = (command.staticCoverage?.[decision.mutantId] ?? 0) > 0
          return Option.match(Option.fromUndefinedOr(decision.static), {
            onNone: () => !isStatic,
            onSome: (flag) => flag === isStatic,
          }) && Array.every(tests, (test) => Array.contains(decision.coveredBy ?? [], test))
        }),
      onFalse: () => true,
    })
  })
})
