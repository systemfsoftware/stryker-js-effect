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
  type TestOutcome,
} from '../core/drain.js'
import { type HarnessTestContext, hooksFor, planRun, type TestRegistry } from '../core/registry.js'
import { closeOpenLayerScopes } from './effect-adapter.js'
const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : new Error('drain failure', { cause }).message

const fireHooks = (
  hooks: readonly ((context: HarnessTestContext) => unknown)[],
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
): Promise<DrainOutcome> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const plan = planRun(registry)
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
        const rejectionListener = (cause: unknown): void => {
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
              const finalizers: Array<(context: HarnessTestContext) => unknown> = []
              const context: HarnessTestContext = {
                signal,
                task: planned.test,
                onTestFinished: (finalizer) => {
                  finalizers.push(finalizer)
                },
              }
              registry.currentTest = context

              yield* fireBeforeAll(planned.chain, context)
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
                    (cause: unknown) => ({ cause }),
                  )
                )
                if (outcome !== undefined) {
                  failureMessage = messageOf(outcome.cause)
                }
              }
              const timeSpentMs = performance.now() - startedAt

              yield* fireHooks([...hooksFor(registry, 'afterEach', planned.chain)].reverse(), context)
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
            registry,
            plan,
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
