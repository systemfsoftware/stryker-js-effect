import { describe, it } from '@effect/vitest'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Struct from 'effect/Struct'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { MutantTestPlanCommand } from '../MutantTestPlanCommand.schema.js'
import {
  CoveredMutantHitCountMissing,
  PlannedEarlyResultMutant,
  PlannedRunMutant,
  planMutantTests,
} from '../plan-mutant-tests.workflow.js'


const smallNonNegativeArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 1000 })))

const testsOf = (command: MutantTestPlanCommand, id: string) =>
  Option.getOrElse(Record.get(command.testsByMutantId, id), (): readonly string[] => [])

const staticCountOf = (command: MutantTestPlanCommand, id: string) =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(command.staticCoverage), (coverage) => Record.get(coverage, id)),
    () => 0,
  )

const hitsOf = (command: MutantTestPlanCommand, id: string) => Option.getOrUndefined(Record.get(command.hitsByMutantId, id))

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
    const mutated = MutantTestPlanCommand.make(
      Struct.evolve(command, { options: (options) => ({ ...options, ignoreStatic: true }) }),
    )
    return Result.match(planMutantTests(mutated), {
      onFailure: () => true,
      onSuccess: (decisions) =>
        decisions.every((decision) => {
          const mutant = mutated.mutants.find((candidate) => candidate.id === decision.mutantId)
          const tests = testsOf(mutated, decision.mutantId)
          const isStatic = staticCountOf(mutated, decision.mutantId) > 0
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
          const testIds = testsOf(command, decision.mutantId)
          const netTime = testIds.reduce((acc, id) => acc + Option.getOrElse(Record.get(command.testTimeById, id), () => 0), 0)
          const isStatic = staticCountOf(command, decision.mutantId) > 0
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
          Option.match(Option.liftPredicate(decision, S.is(PlannedRunMutant)), {
            onNone: () => true,
            onSome: (run) =>
              run.runOptions.hitLimit === Option.getOrUndefined(
                Option.map(Option.fromUndefinedOr(hitsOf(command, run.mutantId)), (hits) => hits * 100),
              ),
          })),
    }))

  it.prop('forall_f_MissingHitCount_refusesCoveredMutant', [scenarioArb], ([command]) =>
    Result.match(planMutantTests(command), {
      onFailure: (failure) =>
        S.is(CoveredMutantHitCountMissing)(failure) && failure.missingIds.length > 0,
      onSuccess: (decisions) =>
        decisions.every((decision) => {
          const mutant = command.mutants.find((candidate) => candidate.id === decision.mutantId)
          const tests = testsOf(command, decision.mutantId)
          const isStatic = staticCountOf(command, decision.mutantId) > 0
          const covered = tests.length > 0 || (command.staticCoverage !== undefined && isStatic)
          return Boolean.match(covered && mutant?.status === undefined, {
            onTrue: () => hitsOf(command, decision.mutantId) !== undefined,
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
        decisions.every((decision) =>
          Option.match(Option.liftPredicate(decision, S.is(PlannedEarlyResultMutant)), {
            onNone: () => true,
            onSome: (early) =>
              Option.match(Option.fromUndefinedOr(command.mutants.find((mutant) => mutant.id === early.mutantId)), {
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
          })),
    }))

  it.prop('forall_r_RunOutcomes_carryMaterializationFields', [scenarioArb], ([command]) =>
    Result.match(planMutantTests(command), {
      onFailure: () => true,
      onSuccess: (decisions) =>
        decisions.every((decision) => {
          if (!S.is(PlannedRunMutant)(decision)) {
            return true
          }
          const tests = testsOf(command, decision.mutantId)
          const isStatic = staticCountOf(command, decision.mutantId) > 0
          return Option.match(Option.fromUndefinedOr(decision.static), {
            onNone: () => !isStatic,
            onSome: (flag) => flag === isStatic,
          }) && Option.match(Option.fromUndefinedOr(command.staticCoverage), {
            onNone: () => decision.coveredBy === undefined,
            onSome: () => tests.every((test) => (decision.coveredBy ?? []).includes(test)),
          })
        }),
    }))
})
