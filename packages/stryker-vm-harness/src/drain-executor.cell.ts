import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import { MixedScheduler, Scheduler } from 'effect/Scheduler'

import {
  type DrainedStatus,
  type DrainOutcome,
  drainRegistry as pureDrainRegistry,
  DrainRegistryCommand,
  DrainTimedOut,
  PlannedTestView,
  type TestOutcome,
} from './drain-registry.workflow.js'
import { closeOpenLayerScopes } from './effect-adapter.handle.js'
import { type FixtureProps, usedFixtureProps } from './fixture-props.js'
import {
  cleanupAll,
  cleanupArrayOf,
  cleanupCountOf,
  cleanupFrom,
  definitionsFor,
  type FixtureDefinition,
  type FixtureHost,
  resolveFixtureValue,
} from './fixtures.js'
import { aroundEachHooksFor, controllerOf, hooksFor, isPendingError, planRun } from './registry.handle.js'
import type {
  AroundRegistration,
  HarnessTestContext,
  HookKind,
  PlannedTest,
  RegisteredHook,
  RegisteredSuite,
  RetryOptions,
  RunnerTest,
  TestRegistry,
} from './registry.schema.js'
import {
  expectStateOf,
  globalConfigOf,
  mockResetConfigOf,
  readGlobalState,
  resetExpectStateFor,
  setWorkerCurrentTask,
} from './sandbox-state.handle.js'
import { decideTestStatus } from './test-status.js'
import type { VmProjectConfig } from './vitest-config.schema.js'

const microtaskImmediate = (run: () => void): () => void => {
  let cancelled = false
  void Promise.resolve().then(() => {
    if (!cancelled) {
      run()
    }
  })
  return () => {
    cancelled = true
  }
}

const microtaskScheduler = new MixedScheduler('async', microtaskImmediate)

const restoreRealTimers = (): void => {
  const vi = readGlobalState()?.vi
  if (vi === undefined) {
    return
  }
  const useRealTimers = Reflect.get(vi, 'useRealTimers')
  if (typeof useRealTimers === 'function') {
    Reflect.apply(useRealTimers, vi, [])
  }
}

const retryAllowanceOf = (retry: number | RetryOptions | undefined, fallback: number): number =>
  typeof retry === 'number' ? retry : typeof retry?.count === 'number' ? retry.count : fallback

const plannedViewOf = (planned: PlannedTest): PlannedTestView =>
  PlannedTestView.make({
    fullName: planned.fullName,
    file: planned.test.file,
    seq: planned.test.seq,
    inverted: false,
    skipped: planned.skipped,
    ...(planned.refusedOnly ? { refusedOnly: true } : {}),
  })

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

export interface DrainTestRef {
  readonly id: string
  readonly name: string
  readonly file: string
}

export interface DrainTestOutcome {
  readonly status: DrainedStatus
  readonly failureMessage: string | undefined
}

export interface DrainRunOptions {
  readonly testFilter?: readonly string[] | undefined
  readonly allowOnlyFor?: ((file: string) => boolean) | undefined
  readonly configFor?: ((file: string) => VmProjectConfig | undefined) | undefined
  readonly beforeFileRun?: ((file: string) => void | Promise<void>) | undefined
  readonly afterFileRun?: ((file: string, isLastFile: boolean) => void | Promise<void>) | undefined
  readonly beforeTest?: ((test: DrainTestRef) => void | Promise<void>) | undefined
  readonly afterTest?: ((test: DrainTestRef, outcome: DrainTestOutcome) => void | Promise<void>) | undefined
}

interface AttemptFailure {
  readonly message: string
  readonly skipped: boolean
}

const attemptFailureOf = (message: string): AttemptFailure => ({ message, skipped: false })
const attemptSkipOf = (message: string): AttemptFailure => ({ message, skipped: true })

type SequenceHooks = VmProjectConfig['sequence']['hooks']

interface RunnerConfig {
  readonly testTimeout: number
  readonly hookTimeout: number
  readonly retry: number
  readonly repeats: number
  readonly maxConcurrency: number
  readonly requireAssertions: boolean
  readonly sequenceHooks: SequenceHooks
  readonly restoreMocks: boolean
  readonly clearMocks: boolean
  readonly mockReset: boolean
  readonly unstubGlobals: boolean
  readonly unstubEnvs: boolean
}

const configOf = (project: VmProjectConfig | undefined): RunnerConfig => ({
  testTimeout: project?.testTimeout ?? 5000,
  hookTimeout: project?.hookTimeout ?? 10000,
  retry: project?.retry ?? 0,
  repeats: project?.repeats ?? 0,
  maxConcurrency: project?.maxConcurrency ?? 5,
  requireAssertions: project?.expect?.requireAssertions ?? false,
  sequenceHooks: project?.sequence?.hooks ?? 'stack',
  restoreMocks: project?.restoreMocks ?? false,
  clearMocks: project?.clearMocks ?? false,
  mockReset: project?.mockReset ?? false,
  unstubGlobals: project?.unstubGlobals ?? false,
  unstubEnvs: project?.unstubEnvs ?? false,
})

const afterHooksFor = (config: RunnerConfig, hooks: ReadonlyArray<RegisteredHook>): ReadonlyArray<RegisteredHook> =>
  config.sequenceHooks === 'stack' ? [...hooks].reverse() : hooks

interface NamePattern {
  readonly source: string
  readonly flags: string
}

const skippedByNamePattern = (
  plan: ReadonlyArray<PlannedTest>,
  pattern: NamePattern | undefined,
): ReadonlyArray<PlannedTest> => {
  if (pattern === undefined) {
    return plan
  }
  const matcher = new RegExp(pattern.source, pattern.flags)
  return plan.map((planned) => (matcher.test(planned.fullName) ? planned : { ...planned, skipped: true }))
}

const timeoutMessageOf = (isHook: boolean, timeoutMs: number): string =>
  `${isHook ? 'Hook' : 'Test'} timed out in ${timeoutMs}ms.\nIf this is a long-running ${
    isHook ? 'hook' : 'test'
  }, pass a timeout value as the last argument or configure it globally with "${
    isHook ? 'hookTimeout' : 'testTimeout'
  }".`

const aroundTimeoutMessageOf = (callbackName: string, hookName: string, timeoutMs: number): string =>
  `The setup phase of "${hookName}" hook timed out after ${timeoutMs}ms. Make sure to call "${callbackName}" to run the ${
    hookName === 'aroundEach' ? 'test' : 'suite'
  }.`

const notCalledMessageOf = (callbackName: string, hookName: string): string =>
  `The "${callbackName}" callback was not called in the "${hookName}" hook. Make sure to call "${callbackName}" to run the ${
    hookName === 'aroundEach' ? 'test' : 'suite'
  }.`

const messageOf = <A = unknown>(cause: A): string =>
  cause instanceof Error ? cause.message : new Error('task failure', { cause }).message

const detach = <A = unknown>(promise: Promise<A>): void => {
  void promise.then(() => undefined, () => undefined)
}

const timeoutOf = <A>(
  effect: Effect.Effect<A>,
  timeoutMs: number | undefined,
  onTimeout: () => void,
): Effect.Effect<A, AttemptFailure> => {
  if (timeoutMs === undefined || timeoutMs <= 0 || timeoutMs === Number.POSITIVE_INFINITY) {
    return effect
  }
  return Effect.flatMap(Effect.timeoutOption(effect, timeoutMs), (option) =>
    Option.isSome(option)
      ? Effect.succeed(option.value)
      : Effect.flatMap(Effect.sync(onTimeout), () => Effect.fail(attemptFailureOf(''))))
}

export type HookCleanup = () => void | Promise<void>

interface FireOutcome {
  readonly value: HookCleanup | undefined
  readonly failure: AttemptFailure | undefined
}

const isCleanup = (value: HookCleanup | undefined | void): value is HookCleanup => typeof value === 'function'

const fireHook = (
  hook: RegisteredHook,
  context: HarnessTestContext,
  defaultTimeoutMs: number,
): Effect.Effect<FireOutcome> => {
  const promise = Promise.resolve().then(() => hook.fn(context))
  const timeoutMs = hook.timeout ?? defaultTimeoutMs
  const ran: Effect.Effect<FireOutcome> = Effect.promise(() =>
    promise.then(
      (value): FireOutcome => ({ value: isCleanup(value) ? value : undefined, failure: undefined }),
      <A = unknown>(cause: A): FireOutcome => ({ value: undefined, failure: attemptFailureOf(messageOf(cause)) }),
    )
  )
  return Effect.map(
    Effect.result(
      timeoutOf(ran, timeoutMs, () => {
        detach(promise)
        controllerOf(context).abort(new Error(timeoutMessageOf(true, timeoutMs)))
      }),
    ),
    (result) =>
      Result.isSuccess(result)
        ? result.success
        : { value: undefined, failure: attemptFailureOf(timeoutMessageOf(true, timeoutMs)) },
  )
}

const fireHookSequence = (
  registered: ReadonlyArray<RegisteredHook>,
  context: HarnessTestContext,
  defaultTimeoutMs: number,
): Effect.Effect<{ readonly cleanups: ReadonlyArray<HookCleanup>; readonly failure: AttemptFailure | undefined }> =>
  Effect.gen(function*() {
    const cleanups: Array<HookCleanup> = []
    for (const hook of registered) {
      const outcome = yield* fireHook(hook, context, defaultTimeoutMs)
      if (outcome.failure !== undefined) {
        return { cleanups, failure: outcome.failure }
      }
      if (isCleanup(outcome.value)) {
        cleanups.push(outcome.value)
      }
    }
    return { cleanups, failure: undefined }
  })

const runTaskHooks = (
  registered: ReadonlyArray<RegisteredHook | RegisteredHook['fn']>,
  context: HarnessTestContext,
  defaultTimeoutMs: number,
): Effect.Effect<AttemptFailure | undefined> =>
  Effect.gen(function*() {
    let failure: AttemptFailure | undefined
    for (const hook of [...registered].reverse()) {
      const registeredHook: RegisteredHook = typeof hook === 'function' ? { fn: hook, timeout: undefined } : hook
      const outcome = yield* fireHook(registeredHook, context, defaultTimeoutMs)
      if (outcome.failure !== undefined && failure === undefined) {
        failure = outcome.failure
      }
    }
    return failure
  })

const runAroundHook = (
  registration: AroundRegistration,
  context: HarnessTestContext,
  defaultTimeoutMs: number,
  callbackName: string,
  hookName: string,
  runInner: () => Effect.Effect<AttemptFailure | undefined>,
): Effect.Effect<AttemptFailure | undefined> =>
  Effect.gen(function*() {
    const timeoutMs = registration.timeout ?? defaultTimeoutMs
    const hooked = Effect.callback<AttemptFailure | undefined, never>((resume) => {
      let settled = false
      const finish = (primary: AttemptFailure | undefined, secondary: AttemptFailure | undefined): void => {
        if (settled) {
          return
        }
        settled = true
        resume(Effect.succeed(primary ?? secondary))
      }
      const innerGate = Promise.withResolvers<void>()
      let innerFailure: AttemptFailure | undefined
      const run = (): Promise<void> => {
        void Effect.runPromise(
          Effect.matchEffect(runInner(), {
            onFailure: (failure) =>
              Effect.sync(() => {
                innerFailure = failure
              }),
            onSuccess: () => Effect.void,
          }),
        ).then(
          () => innerGate.resolve(),
          () => innerGate.resolve(),
        )
        return innerGate.promise
      }
      let runCalled = false
      void Promise.resolve()
        .then(() =>
          registration.hook(() => {
            runCalled = true
            const promised = Promise.resolve().then(run)
            void promised.then(() => innerGate.promise)
            return promised
          }, context)
        )
        .then(
          () => {
            if (!runCalled) {
              finish(attemptFailureOf(notCalledMessageOf(callbackName, hookName)), undefined)
            } else {
              finish(innerFailure, undefined)
            }
          },
          <A = unknown>(cause: A) => {
            finish(attemptFailureOf(messageOf(cause)), innerFailure)
          },
        )
    })
    if (timeoutMs <= 0 || timeoutMs === Number.POSITIVE_INFINITY) {
      return yield* hooked
    }
    return yield* Effect.race(
      hooked,
      Effect.map(Effect.sleep(Duration.millis(timeoutMs)), () =>
        attemptFailureOf(aroundTimeoutMessageOf(callbackName, hookName, timeoutMs))),
    )
  })

const isCallableFixture = (fixture: FixtureDefinition): boolean =>
  fixture.value !== null && typeof fixture.value === 'function'

const resolveDepsOf = (
  used: ReadonlyArray<FixtureDefinition>,
  registrations: ReadonlyMap<string, FixtureDefinition>,
): ReadonlyArray<FixtureDefinition> => {
  const pending: Array<FixtureDefinition> = []
  const visit = (fixture: FixtureDefinition, seen: ReadonlyArray<FixtureDefinition>): void => {
    if (pending.includes(fixture)) {
      return
    }
    if (seen.includes(fixture)) {
      if (fixture.parent !== undefined) {
        visit(fixture.parent, seen)
        pending.push(fixture)
        return
      }
      throw new Error(`Circular fixture dependency detected: ${fixture.name}`)
    }
    const nextSeen = [...seen, fixture]
    if (isCallableFixture(fixture)) {
      for (const depName of fixture.deps) {
        const replacement = depName === fixture.name ? fixture.parent : registrations.get(depName)
        if (replacement !== undefined) {
          visit(replacement, nextSeen)
        }
      }
    }
    pending.push(fixture)
  }
  for (const fixture of used) {
    visit(fixture, [])
  }
  return pending
}

export const executeDrainRegistry = (
  registry: TestRegistry,
  timeoutMs: number | undefined,
  runOptions?: DrainRunOptions,
): Promise<DrainOutcome> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const { afterFileRun, afterTest, allowOnlyFor, beforeFileRun, beforeTest, configFor, testFilter } =
          runOptions ?? {}
        const plan = skippedByNamePattern(
          planWithinFilter(planRun(registry, { allowOnly: true, allowOnlyFor }), testFilter),
          globalConfigOf()?.testNamePattern,
        )
        let config = configOf(undefined)

        const outcomes: Record<string, TestOutcome> = {}
        const storeOutcome = (planned: PlannedTest, outcome: TestOutcome): void => {
          outcomes[String(planned.test.seq)] = outcome
        }

        const fireStage = <A>(hook: ((arg: A) => void | Promise<void>) | undefined, arg: A): Effect.Effect<void> =>
          hook === undefined ? Effect.void : Effect.promise(() => Promise.resolve().then(() => hook(arg)))

        const fireOutcomeStage = <A, B>(
          hook: ((first: A, second: B) => void | Promise<void>) | undefined,
          first: A,
          second: B,
        ): Effect.Effect<void> =>
          hook === undefined ? Effect.void : Effect.promise(() => Promise.resolve().then(() => hook(first, second)))

        interface RunnerNode {
          readonly suite: RegisteredSuite | undefined
          readonly planned: PlannedTest | undefined
          readonly children: Array<RunnerNode>
          readonly concurrent: boolean
          readonly order: number
        }

        let fileNodes = HashMap.empty<string, { readonly children: Array<RunnerNode> }>()
        const childrenOf = (file: string): Array<RunnerNode> => {
          const existing = HashMap.get(fileNodes, file)
          if (Option.isSome(existing)) {
            return existing.value.children
          }
          const created: Array<RunnerNode> = []
          fileNodes = HashMap.set(fileNodes, file, { children: created })
          return created
        }

        let buildNodes = HashMap.empty<number, RunnerNode>()

        for (const suite of [...registry.suites.values()].sort((first, second) => first.id - second.id)) {
          const node: RunnerNode = {
            suite,
            planned: undefined,
            children: [],
            concurrent: suite.concurrent,
            order: suite.order,
          }
          buildNodes = HashMap.set(buildNodes, suite.id, node)
          const parentId = suite.parentIds.at(-1)
          if (parentId === undefined) {
            childrenOf(suite.view.file.filepath).push(node)
          } else {
            const parent = HashMap.get(buildNodes, parentId)
            if (Option.isSome(parent)) {
              parent.value.children.push(node)
            }
          }
        }
        for (const planned of plan) {
          const testNode: RunnerNode = {
            suite: undefined,
            planned,
            children: [],
            concurrent: planned.test.concurrent,
            order: planned.test.order,
          }
          const parentId = planned.chain.at(-1)
          if (parentId === undefined) {
            childrenOf(planned.test.file).push(testNode)
          } else {
            const parent = HashMap.get(buildNodes, parentId)
            if (Option.isSome(parent)) {
              parent.value.children.push(testNode)
            }
          }
        }
        for (const tree of fileNodes.pipe(HashMap.values)) {
          tree.children.sort((first, second) => first.order - second.order)
        }
        for (const node of buildNodes.pipe(HashMap.values)) {
          node.children.sort((first, second) => first.order - second.order)
        }

        const hasRunnableChild = (node: RunnerNode): boolean =>
          node.planned !== undefined ? !node.planned.skipped : node.children.some(hasRunnableChild)

        let usedNamesOf = HashMap.empty<number, FixtureProps>()
        const usedNamesFor = (planned: PlannedTest): FixtureProps => {
          const cached = HashMap.get(usedNamesOf, planned.test.seq)
          if (Option.isSome(cached)) {
            return cached.value
          }
          const stored = planned.test.fixtureNames
          if (stored !== undefined) {
            const storedProps: FixtureProps = Result.succeed(stored)
            usedNamesOf = HashMap.set(usedNamesOf, planned.test.seq, storedProps)
            return storedProps
          }
          const source = planned.test.fn === undefined ? '' : planned.test.fn.toString()
          const parsed = usedFixtureProps(source, 0)
          usedNamesOf = HashMap.set(usedNamesOf, planned.test.seq, parsed)
          return parsed
        }

        let fileContexts = HashMap.empty<string, object>()
        const fileContextOf = (file: string): object => {
          const existing = HashMap.get(fileContexts, file)
          if (Option.isSome(existing)) {
            return existing.value
          }
          const created: object = Object.create(null)
          fileContexts = HashMap.set(fileContexts, file, created)
          return created
        }
        const workerContext: object = Object.create(null)

        const applyFixture = (
          task: RunnerTest,
          fixture: FixtureDefinition,
          fileContext: object,
          clean: Array<() => Promise<void>>,
        ): Effect.Effect<AttemptFailure | undefined> =>
          Effect.gen(function*() {
            if (!isCallableFixture(fixture)) {
              Reflect.set(task.context, fixture.name, fixture.value)
              return undefined
            }
            if (fixture.scope === 'test') {
              const attempted = yield* Effect.result(resolveFixtureValue(fixture, task.context, clean))
              if (Result.isFailure(attempted)) {
                return attemptFailureOf(attempted.failure)
              }
              Reflect.set(task.context, fixture.name, attempted.success)
              return undefined
            }
            const scopedContext = fixture.scope === 'worker' ? workerContext : fileContext
            const key = `fixture:${fixture.name}`
            if (Reflect.has(scopedContext, key)) {
              Reflect.set(task.context, fixture.name, Reflect.get(scopedContext, key))
              return undefined
            }
            const merged = fixture.scope === 'file' ? Object.assign(Object.create(null), scopedContext) : scopedContext
            const attempted = yield* Effect.result(resolveFixtureValue(fixture, merged, cleanupArrayOf(scopedContext)))
            if (Result.isFailure(attempted)) {
              return attemptFailureOf(attempted.failure)
            }
            Reflect.set(scopedContext, key, attempted.success)
            Reflect.set(task.context, fixture.name, attempted.success)
            return undefined
          })

        const resolveFixturesFor = (
          planned: PlannedTest,
          fileContext: object,
          body: () => Effect.Effect<AttemptFailure | undefined>,
        ): Effect.Effect<AttemptFailure | undefined> => {
          const fixtures = planned.test.fixtures
          const task = planned.test.task
          if (fixtures === undefined) {
            return body()
          }
          const suiteHost: FixtureHost | undefined = task.suite ?? task.file
          const registrations = definitionsFor(fixtures, suiteHost)
          if (registrations.size === 0) {
            return body()
          }
          return Effect.gen(function*() {
            const usedProps = usedNamesFor(planned)
            if (Result.isFailure(usedProps)) {
              return attemptFailureOf(usedProps.failure.reason)
            }
            const candidates = [...registrations.values()].filter((fixture) =>
              fixture.auto || usedProps.success.has(fixture.name)
            )
            if (candidates.length === 0) {
              return yield* body()
            }
            const clean = cleanupArrayOf(task.context)
            for (const fixture of resolveDepsOf(candidates, registrations)) {
              const failure = yield* applyFixture(task, fixture, fileContext, clean)
              if (failure !== undefined) {
                return failure
              }
            }
            return yield* body()
          })
        }

        const assertionFailureOf = (): AttemptFailure | undefined => {
          const state = expectStateOf()
          if (state === undefined) {
            return undefined
          }
          const expected = state.expectedAssertionsNumber
          if (expected !== null && expected !== undefined && state.assertionCalls !== expected) {
            return attemptFailureOf(
              `expected number of assertions to be ${String(expected)}, but got ${String(state.assertionCalls)}`,
            )
          }
          if (state.isExpectingAssertions === true && state.assertionCalls === 0) {
            return attemptFailureOf('expected any number of assertion, but got none')
          }
          if (config.requireAssertions && state.assertionCalls === 0) {
            return attemptFailureOf('expected any number of assertion, but got none')
          }
          return undefined
        }

        const softFailureOf = (task: RunnerTest): AttemptFailure | undefined => {
          if (task.result?.state !== 'fail') {
            return undefined
          }
          const error = task.result.errors?.[0]
          return error === undefined ? undefined : attemptFailureOf(error.message)
        }

        const runBodyFor = (planned: PlannedTest, timeoutMs: number): Effect.Effect<AttemptFailure | undefined> => {
          const task = planned.test.task
          const context = task.context
          if (planned.test.fn === undefined) {
            return Effect.succeed(attemptFailureOf('Test has no function body'))
          }
          const promise = Promise.resolve().then(() => planned.test.fn?.(context))
          const ran: Effect.Effect<AttemptFailure | undefined> = Effect.promise(() =>
            promise.then(
              () => undefined,
              <A = unknown>(cause: A) =>
                isPendingError(cause) ? attemptSkipOf(messageOf(cause)) : attemptFailureOf(messageOf(cause)),
            )
          )
          return Effect.map(
            Effect.result(
              timeoutOf(ran, timeoutMs, () => {
                detach(promise)
                controllerOf(context).abort(new Error(timeoutMessageOf(false, timeoutMs)))
              }),
            ),
            (result) => {
              if (Result.isFailure(result)) {
                return attemptFailureOf(timeoutMessageOf(false, timeoutMs))
              }
              if (result.success === undefined) {
                return undefined
              }
              return result.success.message === '' ? undefined : result.success
            },
          )
        }

        const suiteHooksAfterEach = (planned: PlannedTest): ReadonlyArray<RegisteredHook> => {
          const reversed = [...planned.chain].reverse()
          return reversed
            .flatMap((id) => afterHooksFor(config, registry.suiteHooks.get(id)?.afterEach ?? []))
            .concat(afterHooksFor(config, registry.rootHooks.get(planned.test.file)?.afterEach ?? []))
        }

        const runAttempt = (
          planned: PlannedTest,
          fileContext: object,
          aroundChain: ReadonlyArray<AroundRegistration>,
        ): Effect.Effect<AttemptFailure | undefined> => {
          const task = planned.test.task
          const context = task.context
          const runInner = (): Effect.Effect<AttemptFailure | undefined> =>
            Effect.gen(function*() {
              const before = yield* fireHookSequence(
                hooksFor(registry, 'beforeEach', planned.chain, planned.test.file),
                context,
                config.hookTimeout,
              )
              if (before.failure !== undefined) {
                return before.failure
              }
              const fixtureBase = cleanupCountOf(context)
              const bodyFailure = yield* resolveFixturesFor(
                planned,
                fileContext,
                () => runBodyFor(planned, task.timeout ?? config.testTimeout),
              )
              const failure = bodyFailure ?? softFailureOf(task) ?? assertionFailureOf()

              for (const hook of suiteHooksAfterEach(planned)) {
                const outcome = yield* fireHook(hook, context, config.hookTimeout)
                if (outcome.failure !== undefined) {
                  return outcome.failure
                }
              }
              for (const cleanup of [...before.cleanups].reverse()) {
                yield* Effect.promise(() => Promise.resolve().then(() => cleanup()))
              }
              yield* cleanupFrom(context, fixtureBase)
              const finished = yield* runTaskHooks(task.onFinished ?? [], context, config.hookTimeout)
              task.onFinished = undefined
              if (failure !== undefined && (task.onFailed ?? []).length > 0) {
                yield* runTaskHooks(task.onFailed ?? [], context, config.hookTimeout)
              }
              task.onFailed = undefined
              return finished ?? failure
            })
          const runChainAt = (index: number): Effect.Effect<AttemptFailure | undefined> => {
            if (index >= aroundChain.length) {
              return runInner()
            }
            const registration = aroundChain[index]
            if (registration === undefined) {
              return runChainAt(index + 1)
            }
            return runAroundHook(registration, context, config.hookTimeout, 'runTest()', 'aroundEach', () =>
              runChainAt(index + 1))
          }
          return runChainAt(0)
        }

        const invertIfNeeded = (
          planned: PlannedTest,
          task: RunnerTest,
          failure: AttemptFailure | undefined,
        ): AttemptFailure | undefined => {
          if (!planned.test.inverted) {
            return failure
          }
          const syntaxFailure = (task.result?.errors ?? []).some((error) =>
            error.name === 'TestSyntaxError'
          )
          if (syntaxFailure) {
            return failure
          }
          return failure === undefined ? attemptFailureOf('Expect test to fail') : undefined
        }

        const runAttemptCycle = (
          planned: PlannedTest,
          fileContext: object,
        ): Effect.Effect<AttemptFailure | undefined> => {
          const task = planned.test.task
          const aroundChain = aroundEachHooksFor(registry, planned.chain, planned.test.file)
          return Effect.gen(function*() {
            const repeats = task.repeats ?? config.repeats
            const retry = retryAllowanceOf(task.retry, config.retry)
            let failure: AttemptFailure | undefined
            let firstFailure: AttemptFailure | undefined
            for (let repeatCount = 0; repeatCount <= repeats; repeatCount++) {
              for (let retryCount = 0; retryCount <= retry; retryCount++) {
                task.result = {
                  state: 'run',
                  startTime: performance.now(),
                  duration: undefined,
                  retryCount,
                  repeatCount,
                  errors: undefined,
                  note: undefined,
                  pending: undefined,
                }
                resetExpectStateFor(task)
                mockResetConfigOf(config)
                failure = yield* runAttempt(planned, fileContext, aroundChain)
                if (failure !== undefined && failure.skipped) {
                  return failure
                }
                if (failure === undefined) {
                  break
                }
                if (firstFailure === undefined) {
                  firstFailure = failure
                }
              }
            }
            return invertIfNeeded(planned, task, failure === undefined && repeats > 0 ? firstFailure : failure)
          })
        }

        const runOneTest = (planned: PlannedTest, fileContext: object): Effect.Effect<void> =>
          Effect.gen(function*() {
            if (planned.skipped || planned.refusedOnly) {
              return
            }
            const task = planned.test.task
            const startedAt = performance.now()
            setWorkerCurrentTask(task)
            registry.currentTest = task.context
            const ref: DrainTestRef = { id: testIdOf(planned), name: planned.fullName, file: planned.test.file }
            yield* fireStage(beforeTest, ref)

            const failure = yield* runAttemptCycle(planned, fileContext)
            const timeSpentMs = performance.now() - startedAt
            const status: DrainedStatus = decideTestStatus(planned.test.inverted, planned.fullName, {
              failureMessage: failure === undefined ? undefined : failure.message,
              timeSpentMs,
              skipped: failure?.skipped === true,
            }).status
            storeOutcome(planned, {
              failureMessage: failure === undefined || failure.skipped ? undefined : failure.message,
              timeSpentMs,
              skipped: failure?.skipped === true,
            })

            yield* fireOutcomeStage(afterTest, ref, { status, failureMessage: failure?.message })
            registry.currentTest = undefined
            setWorkerCurrentTask(undefined)
          })

        const asHookContext = (target: object): HarnessTestContext =>
          target as HarnessTestContext

        const markChildrenSkipped = (node: RunnerNode): Effect.Effect<void> =>
          Effect.sync(() => {
            const visit = (current: RunnerNode): void => {
              if (current.planned !== undefined && !current.planned.skipped) {
                storeOutcome(current.planned, { failureMessage: undefined, timeSpentMs: 0, skipped: true })
                return
              }
              for (const child of current.children) {
                visit(child)
              }
            }
            visit(node)
          })

        const runSuiteNode = (node: RunnerNode, file: string, fileContext: object): Effect.Effect<void> => {
          if (node.planned !== undefined) {
            return runOneTest(node.planned, fileContext)
          }
          const suite = node.suite
          if (suite === undefined || !hasRunnableChild(node)) {
            return Effect.void
          }
          const suiteView = asHookContext(suite.view)
          const aroundAll = registry.suiteAround.get(suite.id)?.aroundAll ?? []
          let childrenRan = false
          const runChildren = (): Effect.Effect<AttemptFailure | undefined> =>
            Effect.gen(function*() {
              const before = yield* fireHookSequence(
                registry.suiteHooks.get(suite.id)?.beforeAll ?? [],
                suiteView,
                config.hookTimeout,
              )
              if (before.failure !== undefined) {
                return before.failure
              }
              childrenRan = true
              yield* runChildrenNodes(node, file, fileContext)
              for (const cleanup of [...before.cleanups].reverse()) {
                yield* Effect.promise(() =>
                  Promise.resolve().then(() =>
                    cleanup()
                  )
                )
              }
              for (const hook of afterHooksFor(config, registry.suiteHooks.get(suite.id)?.afterAll ?? [])) {
                const outcome = yield* fireHook(hook, suiteView, config.hookTimeout)
                if (outcome.failure !== undefined) {
                  return outcome.failure
                }
              }
              return undefined
            })
          const runChainAt = (index: number): Effect.Effect<AttemptFailure | undefined> => {
            if (index >= aroundAll.length) {
              return runChildren()
            }
            const registration = aroundAll[index]
            if (registration === undefined) {
              return runChainAt(index + 1)
            }
            return runAroundHook(registration, suiteView, config.hookTimeout, 'runSuite()', 'aroundAll', () =>
              runChainAt(index + 1))
          }
          return Effect.gen(function*() {
            const failure = yield* runChainAt(0)
            if (failure !== undefined && !childrenRan) {
              yield* markChildrenSkipped(node)
            }
          })
        }

        const runChildrenNodes = (node: RunnerNode, file: string, fileContext: object): Effect.Effect<void> =>
          Effect.gen(function*() {
            let groupConcurrent = false
            const runWithCeiling = (pending: ReadonlyArray<RunnerNode>, remaining: number): Effect.Effect<void> =>
              remaining <= 0 || pending.length === 0
                ? Effect.forEach(pending, (child) =>
                  runSuiteNode(child, file, fileContext), { discard: true })
                : Effect.gen(function*() {
                  const head = pending.slice(0, remaining)
                  const tail = pending.slice(remaining)
                  yield* Effect.forEach(
                    head,
                    (child) =>
                      Effect.flatMap(Effect.yieldNow, () =>
                        runSuiteNode(child, file, fileContext)),
                    { concurrency: 'unbounded', discard: true },
                  )
                  yield* runWithCeiling(tail, remaining)
                })
            const flush = (concurrent: boolean, pending: ReadonlyArray<RunnerNode>): Effect.Effect<void> => {
              if (pending.length === 0) {
                return Effect.void
              }
              if (!concurrent) {
                return Effect.forEach(pending, (child) =>
                  runSuiteNode(child, file, fileContext), { discard: true })
              }
              const ceiling = config.maxConcurrency <= 0 ? pending.length : config.maxConcurrency
              return runWithCeiling(pending, ceiling)
            }
            let bucket: Array<RunnerNode> = []
            for (const child of node.children) {
              if (bucket.length === 0 || child.concurrent === groupConcurrent) {
                if (bucket.length === 0) {
                  groupConcurrent = child.concurrent
                }
                bucket.push(child)
                continue
              }
              yield* flush(groupConcurrent, bucket)
              bucket = [child]
              groupConcurrent = child.concurrent
            }
            yield* flush(groupConcurrent, bucket)
          })

        const lateRejections: Array<string> = []
        const rejectionListener = <A = unknown>(cause: A): void => {
          lateRejections.push(messageOf(cause))
        }
        globalThis.process.on('unhandledRejection', rejectionListener)

        const rootHooksFor = (kind: HookKind, file: string): ReadonlyArray<RegisteredHook> =>
          registry.rootHooks.get(file)?.[kind] ?? []

        try {
          const runExecution = Effect.gen(function*() {
            const drainingFiles = [...fileNodes].filter(([, tree]) => tree.children.length > 0)
            for (const [fileIndex, [file, tree]] of drainingFiles.entries()) {
              config = configOf(configFor !== undefined ? configFor(file) : globalConfigOf())
              yield* fireStage(beforeFileRun, file)
              const fileView = asHookContext(registry.fileViews.get(file) ?? Object.create(null))
              const fileAround = registry.rootAround.get(file)?.aroundAll ?? []
              const fileNode: RunnerNode = {
                suite: undefined,
                planned: undefined,
                children: tree.children,
                concurrent: false,
                order: 0,
              }
              const runFile = (): Effect.Effect<AttemptFailure | undefined> =>
                Effect.gen(function*() {
                  const before = yield* fireHookSequence(rootHooksFor('beforeAll', file), fileView, config.hookTimeout)
                  if (before.failure !== undefined) {
                    yield* markChildrenSkipped(fileNode)
                    return before.failure
                  }
                  yield* runChildrenNodes(fileNode, file, fileContextOf(file))
                  for (const cleanup of [...before.cleanups].reverse()) {
                    yield* Effect.promise(() => Promise.resolve().then(() => cleanup()))
                  }
                  for (const hook of afterHooksFor(config, rootHooksFor('afterAll', file))) {
                    const outcome = yield* fireHook(hook, fileView, config.hookTimeout)
                    if (outcome.failure !== undefined) {
                      return outcome.failure
                    }
                  }
                  yield* cleanupAll(Option.getOrElse(HashMap.get(fileContexts, file), () => Object.create(null)))
                  return undefined
                })
              if (fileAround.length === 0) {
                yield* runFile()
              } else {
                for (const registration of fileAround) {
                  yield* runAroundHook(registration, fileView, config.hookTimeout, 'runSuite()', 'aroundAll', () =>
                    runFile())
                }
              }
              yield* fireOutcomeStage(afterFileRun, file, fileIndex === drainingFiles.length - 1)
              yield* Effect.sync(restoreRealTimers)
            }
            return outcomes
          })

          const guardedRun = timeoutMs !== undefined
            ? Effect.map(Effect.timeoutOption(runExecution, timeoutMs), (option) =>
              Option.getOrUndefined(option))
            : Effect.map(runExecution, (value) =>
              value)

          const collected = yield* guardedRun
          if (collected === undefined) {
            yield* Effect.promise(() =>
              closeOpenLayerScopes()
            )
            return DrainTimedOut.make({})
          }
          yield* Effect.callback<void>((resume) => {
            setImmediate(() =>
              resume(Effect.void)
            )
          })

          const command = DrainRegistryCommand.make({
            plan: plan.map(plannedViewOf),
            timedOut: false,
            outcomes: collected,
            lateRejections,
          })
          const decision = pureDrainRegistry(command)
          return Result.isSuccess(decision) ? decision.success : DrainTimedOut.make({})
        } finally {
          globalThis.process.off('unhandledRejection', rejectionListener)
        }
      }),
    ).pipe(Effect.provideService(Scheduler, microtaskScheduler)),
  )
