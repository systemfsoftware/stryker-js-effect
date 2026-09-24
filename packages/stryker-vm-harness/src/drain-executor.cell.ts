import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import {
  drainRegistry as pureDrainRegistry,
  type DrainOutcome,
  DrainRegistryCommand,
  DrainTimedOut,
  PlannedTestView,
  type TestOutcome,
} from './drain-registry.workflow.js'
import { closeOpenLayerScopes } from './effect-adapter.handle.js'
import { planRun } from './registry.handle.js'
import type {
  HarnessTestContext,
  HarnessTestFunction,
  HookKind,
  PlannedTest,
  TestRegistry,
} from './registry.schema.js'

const plannedViewOf = (planned: PlannedTest): PlannedTestView =>
  PlannedTestView.make({
    fullName: planned.fullName,
    file: planned.test.file,
    seq: planned.test.seq,
    inverted: planned.test.inverted,
    skipped: planned.skipped,
  })

const messageOf = <A = unknown>(cause: A): string =>
  Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (failure) => failure.message),
    Match.orElse(() => new Error('drain failure', { cause }).message),
  )

const fireHooks = (hooks: readonly HarnessTestFunction[], context: HarnessTestContext): Effect.Effect<void> =>
  Effect.forEach(
    hooks,
    (hook) => Effect.promise(() => Promise.resolve().then(() => hook(context))),
    { discard: true },
  )

const suiteHooksOf = (
  registry: TestRegistry,
  id: number,
  kind: HookKind,
): ReadonlyArray<HarnessTestFunction> =>
  Option.getOrElse(
    Option.flatMap(
      Option.fromNullishOr(registry.suiteHooks.get(id)),
      (hooks) => Option.fromNullishOr(hooks[kind]),
    ),
    () => [],
  )

const hooksFor = (
  registry: TestRegistry,
  kind: HookKind,
  chain: readonly number[],
): ReadonlyArray<HarnessTestFunction> => [
  ...registry.rootHooks[kind],
  ...chain.flatMap((id) => suiteHooksOf(registry, id, kind)),
]

const countOf = (counts: MutableHashMap.MutableHashMap<number, number>, id: number): number =>
  Option.getOrElse(MutableHashMap.get(counts, id), () => 0)

const runnableCountsOf = (plan: ReadonlyArray<PlannedTest>): MutableHashMap.MutableHashMap<number, number> =>
  plan.reduce(
    (counts, planned) =>
      Boolean.match(planned.skipped, {
        onTrue: () => counts,
        onFalse: () =>
          planned.chain.reduce((inner, id) => MutableHashMap.set(inner, id, countOf(inner, id) + 1), counts),
      }),
    MutableHashMap.empty<number, number>(),
  )

const lastRunnableIndexOf = (plan: ReadonlyArray<PlannedTest>): number =>
  Option.getOrElse(
    Option.map(
      Option.fromNullishOr([...plan].reverse().find((planned) => !planned.skipped)),
      (planned) => planned.index,
    ),
    () => -1,
  )

const fireOnce = (
  fired: MutableHashSet.MutableHashSet<number | null>,
  key: number | null,
  fire: () => Effect.Effect<void>,
): Effect.Effect<void> =>
  Effect.suspend(() =>
    Boolean.match(MutableHashSet.has(fired, key), {
      onTrue: () => Effect.void,
      onFalse: () => Effect.sync(() => MutableHashSet.add(fired, key)).pipe(Effect.zipRight(fire())),
    })
  )

const fireBeforeAll = (
  registry: TestRegistry,
  fired: MutableHashSet.MutableHashSet<number | null>,
  chain: readonly number[],
  context: HarnessTestContext,
): Effect.Effect<void> =>
  Effect.gen(function*() {
    yield* fireOnce(fired, null, () => fireHooks(registry.rootHooks.beforeAll, context))
    yield* Effect.forEach(
      chain,
      (id) => fireOnce(fired, id, () => fireHooks(hooksFor(registry, 'beforeAll', [id]), context)),
      { discard: true },
    )
  })

const releaseSuite = (
  registry: TestRegistry,
  counts: MutableHashMap.MutableHashMap<number, number>,
  context: HarnessTestContext,
  suiteId: number,
): Effect.Effect<void> => {
  const remaining = countOf(counts, suiteId) - 1
  MutableHashMap.set(counts, suiteId, remaining)
  return Boolean.match(remaining <= 0, {
    onTrue: () => fireHooks(hooksFor(registry, 'afterAll', [suiteId]), context),
    onFalse: () => Effect.void,
  })
}

const fireAfterAllOf =
  (registry: TestRegistry, counts: MutableHashMap.MutableHashMap<number, number>, context: HarnessTestContext) =>
  (id: number | null): Effect.Effect<void> =>
    Option.match(Option.fromNullishOr(id), {
      onNone: () => fireHooks([...registry.rootHooks.afterAll].reverse(), context),
      onSome: (suiteId) => releaseSuite(registry, counts, context, suiteId),
    })

const failureMessageOfTest = (
  fn: HarnessTestFunction | undefined,
  context: HarnessTestContext,
): Effect.Effect<string | undefined> =>
  Option.match(Option.fromNullishOr(fn), {
    onNone: () => Effect.succeed('Test has no function body'),
    onSome: (present) =>
      Effect.promise(() => Promise.resolve().then(() => present(context)).then(() => undefined, messageOf)),
  })

const maybeFireAfterAll = (
  planned: PlannedTest,
  lastRunnableIndex: number,
  fireAfterAll: (id: number | null) => Effect.Effect<void>,
): Effect.Effect<void> =>
  Boolean.match(planned.index === lastRunnableIndex, {
    onTrue: () => fireAfterAll(null),
    onFalse: () => Effect.void,
  })

const runPlannedTest = (
  registry: TestRegistry,
  counts: MutableHashMap.MutableHashMap<number, number>,
  fired: MutableHashSet.MutableHashSet<number | null>,
  lastRunnableIndex: number,
) =>
(planned: PlannedTest): Effect.Effect<TestOutcome> =>
  Effect.gen(function*() {
    const signal = yield* Effect.abortSignal
    const finalizers: Array<HarnessTestFunction> = []
    const context: HarnessTestContext = {
      signal,
      task: planned.test,
      onTestFinished: (finalizer) => {
        finalizers.push(finalizer)
      },
    }
    registry.currentTest = context
    yield* fireBeforeAll(registry, fired, planned.chain, context)
    yield* fireHooks(hooksFor(registry, 'beforeEach', planned.chain), context)
    const startedAt = performance.now()
    const failureMessage = yield* failureMessageOfTest(planned.test.fn, context)
    const timeSpentMs = performance.now() - startedAt
    yield* fireHooks([...hooksFor(registry, 'afterEach', planned.chain)].reverse(), context)
    yield* fireHooks([...finalizers].reverse(), context)
    yield* Effect.forEach([...planned.chain].reverse(), fireAfterAllOf(registry, counts, context), { discard: true })
    yield* maybeFireAfterAll(planned, lastRunnableIndex, fireAfterAllOf(registry, counts, context))
    registry.currentTest = undefined
    return { failureMessage, timeSpentMs }
  })

const runPlan = (
  registry: TestRegistry,
  plan: ReadonlyArray<PlannedTest>,
  counts: MutableHashMap.MutableHashMap<number, number>,
  fired: MutableHashSet.MutableHashSet<number | null>,
): Effect.Effect<Record<string, TestOutcome>> => {
  const lastRunnableIndex = lastRunnableIndexOf(plan)
  const outcomes: Record<string, TestOutcome> = {}
  return Effect.forEach(
    plan,
    (planned) =>
      Boolean.match(planned.skipped, {
        onTrue: () => Effect.void,
        onFalse: () =>
          Effect.map(runPlannedTest(registry, counts, fired, lastRunnableIndex)(planned), (outcome) => {
            outcomes[String(planned.test.seq)] = outcome
          }),
      }),
    { discard: true },
  ).pipe(Effect.as(outcomes))
}

const runPlanWithTimeout = (
  run: Effect.Effect<Record<string, TestOutcome>>,
  timeoutMs: number | undefined,
): Effect.Effect<Option.Option<Record<string, TestOutcome>>> =>
  Option.match(Option.fromNullishOr(timeoutMs), {
    onNone: () => Effect.map(run, Option.some),
    onSome: (ms) => run.pipe(Effect.timeoutOption(ms)),
  })

const waitForNextTick = (): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    setImmediate(() => resume(Effect.void))
  })

const decidedOutcome = (
  plan: ReadonlyArray<PlannedTest>,
  outcomes: Record<string, TestOutcome>,
  lateRejections: readonly string[],
): DrainOutcome => {
  const command = DrainRegistryCommand.make({
    plan: plan.map(plannedViewOf),
    timedOut: false,
    outcomes,
    lateRejections,
  })
  return Result.match(pureDrainRegistry(command), {
    onFailure: () => DrainTimedOut.make({}),
    onSuccess: (decision) => decision,
  })
}

const settle =
  (plan: ReadonlyArray<PlannedTest>, lateRejections: readonly string[]) =>
  (outcomes: Option.Option<Record<string, TestOutcome>>): Effect.Effect<DrainOutcome> =>
    Option.match(outcomes, {
      onNone: () =>
        waitForNextTick().pipe(
          Effect.zipRight(Effect.promise(() => closeOpenLayerScopes())),
          Effect.as(DrainTimedOut.make({})),
        ),
      onSome: (collected) =>
        waitForNextTick().pipe(Effect.as(decidedOutcome(plan, collected, lateRejections))),
    })

export const executeDrainRegistry: {
  (registry: TestRegistry, timeoutMs: number | undefined): Promise<DrainOutcome>
  (timeoutMs: number | undefined): (registry: TestRegistry) => Promise<DrainOutcome>
} = dual(
  2,
  (registry: TestRegistry, timeoutMs: number | undefined): Promise<DrainOutcome> =>
    Effect.gen(function*() {
      const plan = planRun(registry)
      const counts = runnableCountsOf(plan)
      const fired = MutableHashSet.empty<number | null>()
      const lateRejections: string[] = []
      const rejectionListener = <A = unknown>(cause: A): void => {
        lateRejections.push(messageOf(cause))
      }
      globalThis.process.on('unhandledRejection', rejectionListener)

      try {
        const outcomes = yield* runPlanWithTimeout(runPlan(registry, plan, counts, fired), timeoutMs)
        return yield* settle(plan, lateRejections)(outcomes)
      } finally {
        globalThis.process.off('unhandledRejection', rejectionListener)
      }
    }).pipe(Effect.scoped, Effect.runPromise),
)
