import * as Effect from 'effect/Effect'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'

import { type HarnessTestContext, hooksFor, planRun, type TestRegistry } from './registry.js'

export type DrainedStatus = 'success' | 'failed' | 'skipped'

export interface DrainedTest {
  readonly fullName: string
  readonly file: string
  readonly status: DrainedStatus
  readonly failureMessage: string | undefined
  readonly timeSpentMs: number
}

export type DrainOutcome =
  | { readonly kind: 'complete'; readonly tests: ReadonlyArray<DrainedTest> }
  | { readonly kind: 'timeout' }

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : new Error('drain failure', { cause }).message

export const drainRegistry = (registry: TestRegistry, timeoutMs: number | undefined): Promise<DrainOutcome> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const plan = planRun(registry)
        const tests: DrainedTest[] = []

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
              for (const hook of registry.rootHooks.beforeAll) {
                yield* Effect.promise(() => Promise.resolve().then(() => hook(context)))
              }
            }
            for (const id of chain) {
              if (!MutableHashSet.has(firedBeforeAll, id)) {
                MutableHashSet.add(firedBeforeAll, id)
                for (const hook of hooksFor(registry, 'beforeAll', [id])) {
                  yield* Effect.promise(() => Promise.resolve().then(() => hook(context)))
                }
              }
            }
          })

        const fireAfterAll = (id: number | null, context: HarnessTestContext): Effect.Effect<void> =>
          Effect.gen(function*() {
            if (id === null) {
              for (const hook of [...registry.rootHooks.afterAll].reverse()) {
                yield* Effect.promise(() => Promise.resolve().then(() => hook(context)))
              }
              return
            }
            const current = Option.getOrElse(MutableHashMap.get(runnableCounts, id), () => 0)
            const remaining = current - 1
            MutableHashMap.set(runnableCounts, id, remaining)
            if (remaining <= 0) {
              for (const hook of hooksFor(registry, 'afterAll', [id])) {
                yield* Effect.promise(() => Promise.resolve().then(() => hook(context)))
              }
            }
          })

        const lateRejections: string[] = []
        const rejectionListener = (cause: unknown): void => {
          lateRejections.push(messageOf(cause))
        }
        globalThis.process.on('unhandledRejection', rejectionListener)

        try {
          const runExecution = Effect.gen(function*() {
            for (const planned of plan) {
              if (planned.skipped) {
                tests.push({
                  fullName: planned.fullName,
                  file: planned.test.file,
                  status: 'skipped',
                  failureMessage: undefined,
                  timeSpentMs: 0,
                })
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
              for (const hook of hooksFor(registry, 'beforeEach', planned.chain)) {
                yield* Effect.promise(() => Promise.resolve().then(() => hook(context)))
              }

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

              for (const hook of [...hooksFor(registry, 'afterEach', planned.chain)].reverse()) {
                yield* Effect.promise(() => Promise.resolve().then(() => hook(context)))
              }
              for (const finalizer of [...finalizers].reverse()) {
                yield* Effect.promise(() => Promise.resolve().then(() => finalizer(context)))
              }
              for (const id of [...planned.chain].reverse()) {
                yield* fireAfterAll(id, context)
              }
              if (planned.index === lastRunnableIndex) {
                yield* fireAfterAll(null, context)
              }
              registry.currentTest = undefined
              const threw = failureMessage !== undefined
              const status: DrainedStatus = threw === planned.test.inverted ? 'success' : 'failed'
              const message = threw
                ? failureMessage
                : planned.test.inverted
                ? `${planned.fullName} was expected to fail, but passed`
                : undefined
              tests.push({
                fullName: planned.fullName,
                file: planned.test.file,
                status,
                failureMessage: message,
                timeSpentMs,
              })
            }
            return tests
          })

          const runWithTimeout = timeoutMs !== undefined
            ? runExecution.pipe(
              Effect.timeoutOption(timeoutMs),
              Effect.map((opt) => Option.getOrUndefined(opt)),
            )
            : runExecution

          const drained = yield* runWithTimeout
          if (drained === undefined) {
            return { kind: 'timeout' } as const
          }
          yield* Effect.callback<void>((resume) => {
            setImmediate(() => resume(Effect.void))
          })

          if (lateRejections.length > 0) {
            drained.push({
              fullName: 'unhandled rejection',
              file: '',
              status: 'failed',
              failureMessage: lateRejections.join('\n'),
              timeSpentMs: 0,
            })
          }
          return { kind: 'complete', tests: drained } as const
        } finally {
          globalThis.process.off('unhandledRejection', rejectionListener)
        }
      }),
    ),
  )
