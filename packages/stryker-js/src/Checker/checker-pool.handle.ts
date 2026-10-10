import { Handle } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Pool from 'effect/Pool'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import type { CheckerContractBroken } from '../admit-checker-answer.workflow.js'
import { StageError } from '../Run.schema.js'
import { PhaseClock } from '../run/phase-clock.service.js'
import { sha256HexOf } from '../verdict-semantics.js'
import type { CheckerCrash, CheckerResourceService } from './Checker.handle.js'
import { checkPlans as checkPlansWithChecker, groupPlans as groupPlansWithChecker } from './Checker.plans.js'
import {
  CheckedPlanFailed,
  CheckedPlanIgnored,
  CheckedPlanPassed,
  partitionCheckedPlans,
  PartitionCheckedPlansCommand,
} from './partition-checked-plans.workflow.js'

export const TypeId: unique symbol = Symbol.for('~systemfsoftware/stryker-js/CheckerPool')
export type TypeId = typeof TypeId

export type CheckerSlot = { readonly checkerName: string; readonly checker: CheckerResourceService }[]

export type CheckerPool = Pool.Pool<CheckerSlot, StageError | CheckerCrash>

export interface CheckedPlans<Passed extends Mutant.MutantRunPlan = Mutant.MutantRunPlan> {
  readonly passedPlans: readonly Passed[]
  readonly failedChecks: readonly (readonly [Mutant.MutantRunPlan, Checker.FailedCheckResult])[]
  readonly ignoredChecks: readonly (readonly [Mutant.MutantRunPlan, Checker.IgnoredCheckResult])[]
  readonly checkMsByMutantId: Readonly<Record<string, number>>
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

const onCheckerSlot = <A, R>(
  pool: CheckerPool,
  checkerIndex: number,
  run: (
    checker: CheckerResourceService,
  ) => Effect.Effect<A, CheckerCrash | Checker.CheckerFailed | CheckerContractBroken, R>,
): Effect.Effect<A, StageError | CheckerCrash, R> =>
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

const noPassedPlans: readonly Mutant.MutantRunPlan[] = []

const noFailedChecks: readonly (readonly [Mutant.MutantRunPlan, Checker.FailedCheckResult])[] = []

const noIgnoredChecks: readonly (readonly [Mutant.MutantRunPlan, Checker.IgnoredCheckResult])[] = []

const noCheckMs: Readonly<Record<string, number>> = {}

const checkMsOf = (checkMsByMutantId: Readonly<Record<string, number>>, mutantId: string): number =>
  Option.getOrElse(Option.fromUndefinedOr(checkMsByMutantId[mutantId]), () => 0)

const chargedWith = (
  carried: Readonly<Record<string, number>>,
  group: readonly Mutant.MutantRunPlan[],
  elapsedMs: number,
): Readonly<Record<string, number>> => {
  if (group.length === 0) {
    return carried
  }
  const shareMs = elapsedMs / group.length
  return {
    ...carried,
    ...Object.fromEntries(
      group.map((plan) => [plan.mutant.id, checkMsOf(carried, plan.mutant.id) + shareMs] as const),
    ),
  }
}

export const splitCheckedPlans = Effect.fn(SpanTaxonomy.Spans.checkerPoolSplitChecked.name)(function*(
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
  const ignoredChecks = decisions.flatMap(
    (decision): readonly (readonly [Mutant.MutantRunPlan, Checker.IgnoredCheckResult])[] =>
      Option.match(Option.liftPredicate(decision, S.is(CheckedPlanIgnored)), {
        onNone: () => [],
        onSome: (ignored) =>
          Option.toArray(
            Option.map(Array.get(checked, ignored.entryIndex), ([plan]) => [plan, ignored.result] as const),
          ),
      }),
  )
  return { passedPlans, failedChecks, ignoredChecks } satisfies Omit<CheckedPlans, 'checkMsByMutantId'>
})

const checkerNamesOf = (pool: CheckerPool): Effect.Effect<readonly string[], StageError | CheckerCrash> =>
  Pool.use(pool, (slot) => Effect.succeed(slot.map(({ checkerName }) => checkerName)))

const noDigest = (message: string): Effect.Effect<Option.Option<string>> =>
  Effect.logWarning(message).pipe(Effect.as(Option.none<string>()))

const digestLineOf = (
  project: string,
  { checkerName, checker }: CheckerSlot[number],
): Effect.Effect<Option.Option<string>> =>
  checker.digest(checkerName).pipe(
    Effect.map((digest) => Option.some(`${checkerName}\u0000${digest}`)),
    Effect.catchTags({
      CheckerFailed: (error) =>
        noDigest(`Checker "${checkerName}" could not digest the program of project "${project}": ${error.cause}`),
      ChildProcessCrashedError: (error) =>
        noDigest(
          `Checker "${checkerName}" crashed before it could digest the program of project "${project}": ${error.message}`,
        ),
      OutOfMemoryError: (error) =>
        noDigest(
          `Checker "${checkerName}" ran out of memory before it could digest the program of project "${project}": ${error.message}`,
        ),
    }),
  )

export const programDigestOf = dual<
  (project: string) => (handle: CheckerPoolHandle) => Effect.Effect<string | undefined>,
  (handle: CheckerPoolHandle, project: string) => Effect.Effect<string | undefined>
>(
  2,
  (handle, project) => Effect.orElseSucceed(answeredProgramDigestOf(handle, project), () => undefined),
)

const answeredProgramDigestOf = Effect.fn(SpanTaxonomy.Spans.checkerPoolProgramDigest.name)(function*(
  handle: CheckerPoolHandle,
  project: string,
) {
  const lines = yield* Pool.use(
    CheckerPoolHandle.slot(handle),
    (slot) => Effect.forEach(slot, (entry) => digestLineOf(project, entry)),
  )
  return Option.getOrUndefined(
    Option.map(Option.all(lines), (answered) => sha256HexOf([...answered].sort().join('\n'))),
  )
})

const failedElement = (
  failedChecks: readonly (readonly [Mutant.MutantRunPlan, Checker.FailedCheckResult])[],
  checkMsByMutantId: Readonly<Record<string, number>>,
): Stream.Stream<CheckedPlans, StageError | CheckerCrash> =>
  Option.match(Array.head(failedChecks), {
    onNone: () => Stream.empty,
    onSome: () =>
      Stream.succeed<CheckedPlans>({
        passedPlans: noPassedPlans,
        failedChecks,
        ignoredChecks: noIgnoredChecks,
        checkMsByMutantId,
      }),
  })

const ignoredElement = (
  ignoredChecks: readonly (readonly [Mutant.MutantRunPlan, Checker.IgnoredCheckResult])[],
  checkMsByMutantId: Readonly<Record<string, number>>,
): Stream.Stream<CheckedPlans, StageError | CheckerCrash> =>
  Option.match(Array.head(ignoredChecks), {
    onNone: () => Stream.empty,
    onSome: () =>
      Stream.succeed<CheckedPlans>({
        passedPlans: noPassedPlans,
        failedChecks: noFailedChecks,
        ignoredChecks,
        checkMsByMutantId,
      }),
  })

const checkedGroupsFor = (
  pool: CheckerPool,
  checkerNames: readonly string[],
  checkerIndex: number,
  plans: readonly Mutant.MutantRunPlan[],
  carried: Readonly<Record<string, number>>,
): Stream.Stream<CheckedPlans, StageError | CheckerCrash, PhaseClock> =>
  Option.match(Array.get(checkerNames, checkerIndex), {
    onNone: () =>
      Stream.succeed<CheckedPlans>({
        passedPlans: plans,
        failedChecks: noFailedChecks,
        ignoredChecks: noIgnoredChecks,
        checkMsByMutantId: carried,
      }),
    onSome: (checkerName) =>
      Stream.unwrap(
        onCheckerSlot(pool, checkerIndex, (checker) => groupPlansWithChecker(checker, checkerName, plans)).pipe(
          Effect.map((groups) =>
            Stream.fromIterable(groups).pipe(
              Stream.mapEffect(
                (group) =>
                  onCheckerSlot(pool, checkerIndex, (checker) =>
                    Effect.gen(function*() {
                      const startedAt = yield* Clock.currentTimeMillis
                      const [elapsed, checked] = yield* Effect.timed(checkPlansWithChecker(checker, checkerName, group))
                      const endedAt = yield* Clock.currentTimeMillis
                      yield* (yield* PhaseClock).recordCheckerBusy({ startMs: startedAt, endMs: endedAt })
                      const split = yield* splitCheckedPlans(checked)
                      return { split, charged: chargedWith(carried, group, Duration.toMillis(elapsed)) }
                    })),
                { concurrency: 'unbounded', unordered: true },
              ),
              Stream.flatMap(({ split, charged }) =>
                Stream.concat(
                  ignoredElement(split.ignoredChecks, charged),
                  Stream.concat(
                    failedElement(split.failedChecks, charged),
                    checkedGroupsFor(pool, checkerNames, checkerIndex + 1, split.passedPlans, charged),
                  ),
                )
              ),
            )
          ),
        ),
      ),
  })

export const checkPlansStream: {
  (
    plans: readonly Mutant.MutantRunPlan[],
  ): (checkerPool: CheckerPoolHandle | undefined) => Stream.Stream<CheckedPlans, StageError | CheckerCrash, PhaseClock>
  (
    checkerPool: CheckerPoolHandle | undefined,
    plans: readonly Mutant.MutantRunPlan[],
  ): Stream.Stream<CheckedPlans, StageError | CheckerCrash, PhaseClock>
} = dual(
  2,
  (
    checkerPool: CheckerPoolHandle | undefined,
    plans: readonly Mutant.MutantRunPlan[],
  ): Stream.Stream<CheckedPlans, StageError | CheckerCrash, PhaseClock> =>
    Option.fromNullishOr(checkerPool).pipe(
      Option.match({
        onNone: () =>
          Stream.succeed<CheckedPlans>({
            passedPlans: plans,
            failedChecks: noFailedChecks,
            ignoredChecks: noIgnoredChecks,
            checkMsByMutantId: noCheckMs,
          }),
        onSome: (handle) =>
          checkerNamesOf(CheckerPoolHandle.slot(handle)).pipe(
            Effect.map((checkerNames) =>
              checkedGroupsFor(CheckerPoolHandle.slot(handle), checkerNames, 0, plans, noCheckMs)
            ),
            Stream.unwrap,
          ),
      }),
      Stream.withSpan(SpanTaxonomy.Spans.checkerPoolCheckPlans.name),
    ),
)

export const checkPlans = Effect.fnUntraced(function*(
  checkerPool: CheckerPoolHandle | undefined,
  plans: readonly Mutant.MutantRunPlan[],
) {
  const checkedGroups = yield* Stream.runCollect(checkPlansStream(checkerPool, plans))
  const passedPlans: Mutant.MutantRunPlan[] = []
  const failedChecks: (readonly [Mutant.MutantRunPlan, Checker.FailedCheckResult])[] = []
  const ignoredChecks: (readonly [Mutant.MutantRunPlan, Checker.IgnoredCheckResult])[] = []
  const checkMsByMutantId: Record<string, number> = {}
  for (const group of checkedGroups) {
    passedPlans.push(...group.passedPlans)
    failedChecks.push(...group.failedChecks)
    ignoredChecks.push(...group.ignoredChecks)
    Object.assign(checkMsByMutantId, group.checkMsByMutantId)
  }
  return { passedPlans, failedChecks, ignoredChecks, checkMsByMutantId } satisfies CheckedPlans
})

export interface CheckedPlansExecution<A, E, Passed extends Mutant.MutantRunPlan = Mutant.MutantRunPlan> {
  readonly settleFailure: (
    plan: Mutant.MutantRunPlan,
    result: Checker.FailedCheckResult,
    checkMs: number,
  ) => Effect.Effect<A, E>
  readonly settleIgnored: (plan: Mutant.MutantRunPlan, result: Checker.IgnoredCheckResult) => Effect.Effect<A, E>
  readonly runPlan: (plan: Passed, checkMs: number) => Effect.Effect<A, E>
  readonly concurrency: number
}

export const runCheckedPlans: {
  <A, E, Passed extends Mutant.MutantRunPlan>(
    execution: CheckedPlansExecution<A, E, Passed>,
  ): (
    self: Stream.Stream<CheckedPlans<Passed>, StageError | CheckerCrash, PhaseClock>,
  ) => Stream.Stream<A, E | StageError | CheckerCrash, PhaseClock>
  <A, E, Passed extends Mutant.MutantRunPlan>(
    self: Stream.Stream<CheckedPlans<Passed>, StageError | CheckerCrash, PhaseClock>,
    execution: CheckedPlansExecution<A, E, Passed>,
  ): Stream.Stream<A, E | StageError | CheckerCrash, PhaseClock>
} = dual(
  2,
  <A, E, Passed extends Mutant.MutantRunPlan>(
    self: Stream.Stream<CheckedPlans<Passed>, StageError | CheckerCrash, PhaseClock>,
    execution: CheckedPlansExecution<A, E, Passed>,
  ): Stream.Stream<A, E | StageError | CheckerCrash, PhaseClock> =>
    self.pipe(
      Stream.flatMap(({ passedPlans, failedChecks, ignoredChecks, checkMsByMutantId }) =>
        Stream.fromIterable<() => Effect.Effect<A, E>>([
          ...failedChecks.map(([plan, result]) => () =>
            execution.settleFailure(plan, result, checkMsOf(checkMsByMutantId, plan.mutant.id))
          ),
          ...ignoredChecks.map(([plan, result]) => () => execution.settleIgnored(plan, result)),
          ...passedPlans.map((plan) => () => execution.runPlan(plan, checkMsOf(checkMsByMutantId, plan.mutant.id))),
        ])
      ),
      Stream.mapEffect((work) => work(), { concurrency: Math.max(1, execution.concurrency), unordered: true }),
    ),
)

export const inOwnScope = Effect.fn(SpanTaxonomy.Spans.mutationTestCheckerScope.name)(function*<Resources, RAcquire>(
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
