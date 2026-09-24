import { describe, it } from '@effect/vitest'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import type { MutantTestPlanCommand } from '../MutantTestPlanCommand.schema.js'
import {
  CoveredMutantHitCountMissing,
  PlannedEarlyResultMutant,
  PlannedRunMutant,
  planMutantTests,
} from '../plan-mutant-tests.workflow.js'

const PlanDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantPlan')

const smallNonNegativeArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 1000 })))

const scenarioArb: Arbitrary.Arbitrary<MutantTestPlanCommand> = Arbitrary.schema(
  S.Array(Mutant).check(S.isMinLength(1)),
).pipe(
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
            const overheadBounded = timeOverheadMS % 4000
            const hitsByMutantId: Record<string, number> = Object.fromEntries(
              perMutant
                .filter((entry) => entry.isCovered)
                .map((entry) => [entry.mutant.id, entry.hitCount] as const),
            )
            const coveredByTests: Record<string, ReadonlyArray<string>> = Object.fromEntries(
              perMutant
                .filter((entry) => entry.isCovered)
                .map((entry) => [entry.mutant.id, [`test-${entry.mutant.id}`]] as const),
            )
            const testTimeById: Record<string, number> = Object.fromEntries(
              perMutant
                .filter((entry) => entry.isCovered)
                .map((entry) => [`test-${entry.mutant.id}`, 7] as const),
            )
            const staticCoverage: Record<string, number> = Object.fromEntries(
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

const IgnoredStaticReason = 'Static mutant (and "ignoreStatic" was enabled)'

describe('planMutantTests', () => {
  it.prop('forall_d_DecisionBrand_present', [S.Union([PlannedRunMutant, PlannedEarlyResultMutant])], ([decision]) =>
    Object.getOwnPropertySymbols(decision).includes(PlanDecisionTypeId))

  it.prop('forall_m_Command_ordersOutcomesByMutantOrder', [scenarioArb], ([command]) =>
    Result.match(planMutantTests(command), {
      onFailure: () => true,
      onSuccess: (decisions) =>
        decisions.length === command.mutants.length &&
        decisions.every((decision, index) =>
          Option.match(Option.fromUndefinedOr(command.mutants[index]), {
            onNone: () => false,
            onSome: (mutant) => decision.mutantId === mutant.id,
          })),
    }))

  it.prop('forall_c_ClosedMutant_decidesEarlyResult', [scenarioArb], ([command]) =>
    Result.match(planMutantTests(command), {
      onFailure: () => true,
      onSuccess: (decisions) =>
        decisions.every((decision) =>
          Option.match(
            Option.fromUndefinedOr(command.mutants.find((candidate) => candidate.id === decision.mutantId)),
            {
              onNone: () => false,
              onSome: (mutant) =>
                mutant.status === undefined || S.is(PlannedEarlyResultMutant)(decision),
            },
          )),
    }))

  it.prop('forall_s_StaticMutantWithoutCoveringTests_decidesIgnored', [scenarioArb], ([command]) => {
    const mutated: MutantTestPlanCommand = {
      ...command,
      options: { ...command.options, ignoreStatic: true },
    }
    return Result.match(planMutantTests(mutated), {
      onFailure: () => true,
      onSuccess: (decisions) =>
        decisions.every((decision) => {
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
        }),
    })
  })

  it.prop('forall_t_CoveredTestTime_conservesNetTime', [scenarioArb], ([command]) =>
    Result.match(planMutantTests(command), {
      onFailure: () => true,
      onSuccess: (decisions) =>
        decisions.every((decision) => {
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
        }),
    }))

  it.prop('forall_h_HitLimit_conservesHundredfold', [scenarioArb], ([command]) =>
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
    }))

  it.prop('forall_f_MissingHitCount_refusesCoveredMutant', [scenarioArb], ([command]) =>
    Result.match(planMutantTests(command), {
      onFailure: (failure) =>
        failure instanceof CoveredMutantHitCountMissing && failure.missingIds.length > 0,
      onSuccess: (decisions) =>
        decisions.every((decision) => {
          const mutant = command.mutants.find((candidate) => candidate.id === decision.mutantId)
          const tests = command.testsByMutantId[decision.mutantId] ?? []
          const isStatic = (command.staticCoverage?.[decision.mutantId] ?? 0) > 0
          const covered = tests.length > 0 || (command.staticCoverage !== undefined && isStatic)
          return Boolean.match(covered && mutant?.status === undefined, {
            onTrue: () => command.hitsByMutantId[decision.mutantId] !== undefined,
            onFalse: () => true,
          })
        }),
    }))
})

describe('planMutantTests materialization fields', () => {
  it.prop('forall_u_EarlyOutcomes_carryStaticAndCoveredBy', [scenarioArb], ([command]) =>
    Result.match(planMutantTests(command), {
      onFailure: () => true,
      onSuccess: (decisions) =>
        decisions.every((decision) => {
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
    }))

  it.prop('forall_r_RunOutcomes_carryMaterializationFields', [scenarioArb], ([command]) =>
    Result.match(planMutantTests(command), {
      onFailure: () => true,
      onSuccess: (decisions) =>
        decisions.every((decision) => {
          if (!S.is(PlannedRunMutant)(decision)) {
            return true
          }
          const tests = command.testsByMutantId[decision.mutantId] ?? []
          const isStatic = (command.staticCoverage?.[decision.mutantId] ?? 0) > 0
          return Option.match(Option.fromUndefinedOr(decision.static), {
            onNone: () => !isStatic,
            onSome: (flag) => flag === isStatic,
          }) && tests.every((test) => (decision.coveredBy ?? []).includes(test))
        }),
    }))
})
