import * as Effect from 'effect/Effect'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import {
  type DrainOutcome,
  drainRegistry as pureDrainRegistry,
  DrainRegistryCommand,
  DrainTimedOut,
  PlannedTestView,
  type TestOutcome,
} from '../core/drain-registry.workflow.js'
import {
  type HarnessTestContext,
  type HarnessTestFunction,
  hooksFor,
  type PlannedTest,
  planRun,
  type TestRegistry,
} from '../core/registry.js'
import { closeOpenLayerScopes } from './effect-adapter.js'

const plannedViewOf = (planned: PlannedTest): PlannedTestView =>
  PlannedTestView.make({
    fullName: planned.fullName,
    file: planned.test.file,
    seq: planned.test.seq,
    inverted: planned.test.inverted,
    skipped: planned.skipped,
  })

const messageOf = <A = unknown>(cause: A): string =>
  cause instanceof Error ? cause.message : new Error('drain failure', { cause }).message

const testIdOf = (planned: PlannedTest): string => `${planned.test.file}#${planned.fullName}`

const planWithinFilter = (
  plan: ReadonlyArray<PlannedTest>,
  testFilter: readonly string[] | undefined,
): ReadonlyArray<PlannedTest> => {
  if (testFilter === undefined) {
    return plan
  }
  const wanted = new Set(testFilter)
  return plan.filter((planned) => wanted.has(testIdOf(planned)))
}

export interface DrainRunOptions {
  readonly testFilter?: readonly string[] | undefined
  readonly onTestStart?: ((testId: string) => void) | undefined
  readonly onTestEnd?: (() => void) | undefined
}

const fireHooks = (
  hooks: readonly HarnessTestFunction[],
  context: HarnessTestContext,
): Effect.Effect<void> =>
  Effect.gen(function*() {
    for (const hook of hooks) {
      yield* Effect.promise(() => Promise.resolve().then(() => hook(context)))
    }
  })

export const executeDrainRegistry = (
  registry: TestRegistry,
  timeoutMs: number | undefined,
  runOptions?: DrainRunOptions,
): Promise<DrainOutcome> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const { onTestEnd, onTestStart, testFilter } = runOptions ?? {}
        const plan = planWithinFilter(planRun(registry), testFilter)
        const runnableCounts = MutableHashMap.empty<number, number>()
        for (const planned of plan) {
          if (!planned.skipped) {
            for (const id of planned.chain) {
              const current = Option.getOrElse(MutableHashMap.get(runnableCounts, id), () => 0)
              MutableHashMap.set(runnableCounts, id, current + 1)
            }
          }
        }

        const lastRunnable = [...plan].reverse().find((planned) => !planned.skipped)
        const lastRunnableIndex = lastRunnable !== undefined ? lastRunnable.index : -1

        const firedBeforeAll = MutableHashSet.empty<number | null>()
        const fireBeforeAll = (chain: readonly number[], context: HarnessTestContext): Effect.Effect<void> =>
          Effect.gen(function*() {
            if (!MutableHashSet.has(firedBeforeAll, null)) {
              MutableHashSet.add(firedBeforeAll, null)
              yield* fireHooks(registry.rootHooks.beforeAll, context)
            }
            for (const id of chain) {
              if (!MutableHashSet.has(firedBeforeAll, id)) {
                MutableHashSet.add(firedBeforeAll, id)
                yield* fireHooks(hooksFor(registry, 'beforeAll', [id]), context)
              }
            }
          })

        const fireAfterAll = (id: number | null, context: HarnessTestContext): Effect.Effect<void> =>
          Effect.gen(function*() {
            if (id === null) {
              yield* fireHooks([...registry.rootHooks.afterAll].reverse(), context)
              return
            }
            const current = Option.getOrElse(MutableHashMap.get(runnableCounts, id), () => 0)
            const remaining = current - 1
            MutableHashMap.set(runnableCounts, id, remaining)
            if (remaining <= 0) {
              yield* fireHooks(hooksFor(registry, 'afterAll', [id]), context)
            }
          })

        const lateRejections: string[] = []
        const rejectionListener = <A = unknown>(cause: A): void => {
          lateRejections.push(messageOf(cause))
        }
        globalThis.process.on('unhandledRejection', rejectionListener)

        try {
          const runExecution = Effect.gen(function*() {
            const outcomes: Record<string, TestOutcome> = {}

            for (const planned of plan) {
              if (planned.skipped) {
                continue
              }
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

              yield* fireBeforeAll(planned.chain, context)
              if (onTestStart !== undefined) {
                onTestStart(testIdOf(planned))
              }
              yield* fireHooks(hooksFor(registry, 'beforeEach', planned.chain), context)

              const startedAt = performance.now()
              let failureMessage: string | undefined
              if (planned.test.fn === undefined) {
                failureMessage = 'Test has no function body'
              } else {
                const testPromise = Promise.resolve().then(() => planned.test.fn?.(context))
                const outcome = yield* Effect.promise(() =>
                  testPromise.then(
                    () => undefined,
                    <A = unknown>(cause: A) => ({ cause }),
                  )
                )
                if (outcome !== undefined) {
                  failureMessage = messageOf(outcome.cause)
                }
              }
              const timeSpentMs = performance.now() - startedAt

              yield* fireHooks([...hooksFor(registry, 'afterEach', planned.chain)].reverse(), context)
              if (onTestEnd !== undefined) {
                onTestEnd()
              }
              yield* fireHooks([...finalizers].reverse(), context)
              for (const id of [...planned.chain].reverse()) {
                yield* fireAfterAll(id, context)
              }
              if (planned.index === lastRunnableIndex) {
                yield* fireAfterAll(null, context)
              }
              registry.currentTest = undefined

              outcomes[String(planned.test.seq)] = {
                failureMessage,
                timeSpentMs,
              }
            }
            return outcomes
          })

          const runWithTimeout = timeoutMs !== undefined
            ? runExecution.pipe(
              Effect.timeoutOption(timeoutMs),
              Effect.map((opt) => Option.getOrUndefined(opt)),
            )
            : runExecution

          const collectedOutcomes = yield* runWithTimeout
          if (collectedOutcomes === undefined) {
            yield* Effect.callback<void>((resume) => {
              setImmediate(() => resume(Effect.void))
            })
            yield* Effect.promise(() => closeOpenLayerScopes())
            return DrainTimedOut.make({})
          }
          yield* Effect.callback<void>((resume) => {
            setImmediate(() => resume(Effect.void))
          })

          const command = DrainRegistryCommand.make({
            plan: plan.map(plannedViewOf),
            timedOut: false,
            outcomes: collectedOutcomes,
            lateRejections,
          })
          const decision = pureDrainRegistry(command)
          return Result.isSuccess(decision) ? decision.success : DrainTimedOut.make({})
        } finally {
          globalThis.process.off('unhandledRejection', rejectionListener)
        }
      }),
    ),
  )
