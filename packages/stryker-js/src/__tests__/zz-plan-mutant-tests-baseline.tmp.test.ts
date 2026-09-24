import { describe, it } from '@effect/vitest'
import { pathToFileURL } from 'node:url'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { MutantTestPlanCommand } from '../MutantTestPlanCommand.schema.js'
import {
  PlannedEarlyResultMutant,
  PlannedRunMutant,
  planMutantTests,
} from '../plan-mutant-tests.workflow.js'

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

const smallNonNegativeArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 1000 })))

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
          Arbitrary.map(([ignoreStatic, disableBail, timeOverheadMS]): MutantTestPlanCommand => {
            const overheadBounded = timeOverheadMS % 4000
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
            return {
              _tag: 'MutantTestPlanCommand',
              mutants: [...mutants],
              timeOverheadMS: overheadBounded,
              timeSpentAllTests: 42,
              hitsByMutantId,
              staticCoverage: Object.keys(staticCoverage).length === 0 ? undefined : staticCoverage,
              testsByMutantId: coveredByTests,
              testTimeById,
              options: { disableBail, timeoutMS: 2000, timeoutFactor: 1.5, ignoreStatic },
              sandboxFileByName: {},
            }
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

describe('planMutantTests baseline oracle', () => {
  it.prop('forall_o_Oracle_matchesBaselinePlanner', [scenarioArb], async ([command]) => {
    const baseline = await loadBaselinePlanner()
    const encoded = JSON.parse(JSON.stringify(command))
    const missing = baseline.missingHitCountIds(encoded)
    const actual = planMutantTests(command)
    return Boolean.match(missing.length > 0, {
      onTrue: () =>
        Result.isFailure(actual) &&
        JSON.stringify(actual.failure.missingIds) === JSON.stringify(missing),
      onFalse: () =>
        Result.match(actual, {
          onFailure: () => false,
          onSuccess: (decisions) => {
            const expected = baseline.planMutantTests(encoded)
            return (
              decisions.length === expected.plans.length &&
              decisions.every((decision, index) => {
                const expectedPlan = expected.plans[index]
                return expectedPlan !== undefined && plansEqual(plainOf(decision), expectedPlan)
              })
            )
          },
        }),
    })
  })

  it.prop('forall_m_MissingHitCount_listsEveryCoveredMutantWithoutHits', [scenarioArb], async ([command]) => {
    const baseline = await loadBaselinePlanner()
    const encoded = JSON.parse(JSON.stringify(command))
    const missing = baseline.missingHitCountIds(encoded)
    const actual = planMutantTests(command)
    return Boolean.match(missing.length > 0, {
      onTrue: () =>
        Result.isFailure(actual) &&
        actual.failure.missingIds.length === missing.length &&
        Option.match(Option.fromUndefinedOr(missing[0]), {
          onNone: () => false,
          onSome: (first) => actual.failure.missingIds[0] === first,
        }),
      onFalse: () => Result.isSuccess(actual),
    })
  })
})
