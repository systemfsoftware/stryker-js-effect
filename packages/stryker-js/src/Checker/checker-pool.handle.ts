import { Handle } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Pool from 'effect/Pool'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'

import type { CheckerContractBroken } from '../admit-checker-answer.workflow.js'
import { StageError } from '../Run.schema.js'
import { checkPlans as checkPlansWithChecker, groupPlans as groupPlansWithChecker } from './Checker.cell.js'
import type { CheckerCrash, CheckerResourceService } from './Checker.handle.js'
import {
  CheckedPlanFailed,
  CheckedPlanPassed,
  partitionCheckedPlans,
  PartitionCheckedPlansCommand,
} from './partition-checked-plans.workflow.js'

export const TypeId: unique symbol = Symbol.for('~systemfsoftware/stryker-js/CheckerPool')
export type TypeId = typeof TypeId

export type CheckerSlot = { readonly checkerName: string; readonly checker: CheckerResourceService }[]

export type CheckerPool = Pool.Pool<CheckerSlot, StageError | CheckerCrash>

export interface CheckedPlans {
  readonly passedPlans: readonly Mutant.MutantRunPlan[]
  readonly failedChecks: readonly (readonly [Mutant.MutantRunPlan, Checker.FailedCheckResult])[]
}

const CheckerPoolHandle = Handle.make<Record<never, never>, CheckerPool>()(TypeId)

export type CheckerPoolHandle = Handle.Of<typeof CheckerPoolHandle>

export const isCheckerPoolHandle = CheckerPoolHandle.is

export const makeCheckerPoolHandle = (pool: CheckerPool): CheckerPoolHandle => CheckerPoolHandle.make({}, pool)

export const isCheckerCrash = (error: StageError | CheckerCrash): boolean =>
  Match.value(error).pipe(
    Match.tag('ChildProcessCrashedError', 'OutOfMemoryError', () => true),
    Match.orElse(() => false),
  )

const checkerBreachToStageError = (error: CheckerContractBroken | Checker.CheckerFailed): StageError =>
  Match.value(error).pipe(
    Match.tag(
      'CheckerFailed',
      (failed) => StageError.make({ stage: 'mutationTest', reason: failed.cause, cause: failed }),
    ),
    Match.tag('CheckerAnsweredUnrequested', (breach) =>
      StageError.make({
        stage: 'mutationTest',
        reason:
          `Checker "${breach.checkerName}" answered about mutants it was not asked about (${breach.phase} phase): ${
            breach.unrequestedIds.join(', ')
          }`,
        cause: breach,
      })),
    Match.tag('CheckerSkippedRequested', (breach) =>
      StageError.make({
        stage: 'mutationTest',
        reason: `Checker "${breach.checkerName}" skipped requested mutants (${breach.phase} phase): ${
          breach.missingIds.join(', ')
        }`,
        cause: breach,
      })),
    Match.exhaustive,
  )

const invalidateSlot = <E>(
  pool: CheckerPool,
  slot: CheckerSlot,
  error: E,
): Effect.Effect<never, E> => Effect.flatMap(Pool.invalidate(pool, slot), () => Effect.fail(error))

const onCheckerSlot = <A>(
  pool: CheckerPool,
  checkerIndex: number,
  run: (
    checker: CheckerResourceService,
  ) => Effect.Effect<A, CheckerCrash | Checker.CheckerFailed | CheckerContractBroken>,
): Effect.Effect<A, StageError | CheckerCrash> =>
  Pool.use(pool, (slot) =>
    Option.match(Option.fromUndefinedOr(slot[checkerIndex]), {
      onNone: () => Effect.die(new Error(`checker slot has no entry at index ${checkerIndex}`)),
      onSome: ({ checker }) =>
        run(checker).pipe(
          Effect.catchTags({
            OutOfMemoryError: (error) => invalidateSlot(pool, slot, error),
            ChildProcessCrashedError: (error) => invalidateSlot(pool, slot, error),
            CheckerFailed: (error) => error.pipe(checkerBreachToStageError, Effect.fail),
            CheckerAnsweredUnrequested: (error) => error.pipe(checkerBreachToStageError, Effect.fail),
            CheckerSkippedRequested: (error) => error.pipe(checkerBreachToStageError, Effect.fail),
          }),
        ),
    }))

const checkGroupsConcurrently = (
  pool: CheckerPool,
  checkerIndex: number,
  checkerName: string,
  currentPlans: readonly Mutant.MutantRunPlan[],
): Effect.Effect<
  readonly (readonly [Mutant.MutantRunPlan, Checker.CheckResult])[],
  StageError | CheckerCrash
> =>
  Effect.flatMap(
    onCheckerSlot(pool, checkerIndex, (checker) => groupPlansWithChecker(checker, checkerName, currentPlans)),
    (groups) =>
      Effect.map(
        Effect.forEach(
          groups,
          (group) => onCheckerSlot(pool, checkerIndex, (checker) => checkPlansWithChecker(checker, checkerName, group)),
          { concurrency: 'unbounded' },
        ),
        (perGroup) => perGroup.flat(),
      ),
  )

export const splitCheckedPlans = Effect.fn('stryker.checker_pool.split_checked')(function*(
  checked: readonly (readonly [Mutant.MutantRunPlan, Checker.CheckResult])[],
) {
  const decisions = yield* Effect.fromResult(
    partitionCheckedPlans(
      PartitionCheckedPlansCommand.make({
        checked: checked.map(([plan, result]) => [plan.mutant.id, result] as const),
      }),
    ),
  )
  const passedPlans = decisions.flatMap((decision): readonly Mutant.MutantRunPlan[] =>
    Option.match(Option.liftPredicate(decision, S.is(CheckedPlanPassed)), {
      onNone: () => [],
      onSome: (passed) => Option.toArray(Option.map(Array.get(checked, passed.entryIndex), ([plan]) => plan)),
    })
  )
  const failedChecks = decisions.flatMap(
    (decision): readonly (readonly [Mutant.MutantRunPlan, Checker.FailedCheckResult])[] =>
      Option.match(Option.liftPredicate(decision, S.is(CheckedPlanFailed)), {
        onNone: () => [],
        onSome: (failed) =>
          Option.toArray(Option.map(Array.get(checked, failed.entryIndex), ([plan]) => [plan, failed.result] as const)),
      }),
  )
  return { passedPlans, failedChecks }
})

const stepOneChecker = (
  pool: CheckerPool,
  checkerIndex: number,
  checkerName: string,
  currentPlans: readonly Mutant.MutantRunPlan[],
) =>
  checkGroupsConcurrently(pool, checkerIndex, checkerName, currentPlans).pipe(
    Effect.flatMap((checked) => splitCheckedPlans(checked)),
  )

const runConfiguredCheckers = (
  pool: CheckerPool,
  plans: readonly Mutant.MutantRunPlan[],
): Effect.Effect<CheckedPlans, StageError | CheckerCrash> =>
  Effect.flatMap(
    Pool.use(pool, (slot) => Effect.succeed(slot.map(({ checkerName }) => checkerName))),
    (checkerNames) => {
      const failedChecks: (readonly [Mutant.MutantRunPlan, Checker.FailedCheckResult])[] = []
      const checkedPlans: CheckedPlans = { passedPlans: plans, failedChecks }
      return Effect.reduce(
        checkerNames,
        () => checkedPlans,
        (acc, checkerName, checkerIndex) =>
          Effect.map(
            stepOneChecker(pool, checkerIndex, checkerName, acc.passedPlans),
            (split) => {
              failedChecks.push(...split.failedChecks)
              return { passedPlans: split.passedPlans, failedChecks }
            },
          ),
      )
    },
  )

export const checkPlans = Effect.fn('stryker.checker_pool.check_plans')(function*(
  checkerPool: CheckerPoolHandle | undefined,
  plans: readonly Mutant.MutantRunPlan[],
) {
  return yield* Option.match(Option.fromNullishOr(checkerPool), {
    onNone: (): Effect.Effect<CheckedPlans> => Effect.succeed({ passedPlans: plans, failedChecks: [] }),
    onSome: (handle) => runConfiguredCheckers(CheckerPoolHandle.slot(handle), plans),
  })
})

export const inOwnScope = Effect.fn('stryker.mutation_test.checker_scope')(function*<Resources, RAcquire>(
  acquire: Effect.Effect<Resources, never, Scope.Scope | RAcquire>,
) {
  const checkerScope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(checkerScope, Exit.void))
  const resources = yield* acquire.pipe(Scope.provide(checkerScope))
  return {
    resources,
    releaseInBackground: Scope.close(checkerScope, Exit.void).pipe(Effect.forkScoped({ uninterruptible: true })),
  }
})
