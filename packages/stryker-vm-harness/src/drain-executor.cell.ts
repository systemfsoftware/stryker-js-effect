import type * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
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
  type FixtureValue,
  resolveFixtureValue,
} from './fixtures.js'
import { hostImmediate, hostNowMillis } from './host-time.js'
import { aroundEachHooksFor, controllerOf, hooksFor, isPendingError, planRun } from './registry.js'
import type {
  AroundRegistration,
  HarnessTestContext,
  HookKind,
  HookSets,
  PlannedTest,
  RegisteredHook,
  RegisteredSuite,
  RetryOptions,
  RunnerTest,
  TaskError,
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

interface ExpectState {
  readonly assertionCalls: number
  readonly expectedAssertionsNumber: number | null | undefined
  readonly isExpectingAssertions: boolean | undefined
}

const nullObject = (): object => ({ __proto__: null })

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

interface TimerVi {
  readonly useRealTimers: (...args: ReadonlyArray<never>) => void
}

const isTimerVi = (value: object): value is TimerVi => typeof Reflect.get(value, 'useRealTimers') === 'function'

const applyRealTimersRestore = (vi: object): void => {
  if (isTimerVi(vi)) {
    Reflect.apply(vi.useRealTimers, vi, [])
  }
}

const restoreRealTimers = (): void =>
  Option.match(
    Option.flatMap(Option.fromNullishOr(readGlobalState()), (state) => Option.fromNullishOr(state.vi)),
    {
      onNone: () => undefined,
      onSome: (vi) => applyRealTimersRestore(vi),
    },
  )

const withDefault = <A>(value: A | undefined, fallback: A): A =>
  Option.getOrElse(Option.fromNullishOr(value), () => fallback)

const firstKnown = <A>(first: A | undefined, second: A | undefined): A | undefined => first ?? second

const firstOf = <A>(values: ReadonlyArray<A>): Option.Option<A> => Option.fromNullishOr(values[0])

const firstFailureOf = (outcomes: ReadonlyArray<FireOutcome>): AttemptFailure | undefined =>
  outcomes.map((outcome) => outcome.failure).find((failure) => failure !== undefined)

const isSkippedFailure = (failure: AttemptFailure | undefined): boolean =>
  Option.getOrElse(
    Option.map(Option.fromNullishOr(failure), (present) => present.skipped),
    () => false,
  )

const attemptMessageOf = (failure: AttemptFailure | undefined): string | undefined =>
  Option.getOrUndefined(Option.map(Option.fromNullishOr(failure), (present) => present.message))

const retryCountOf = (retry: RetryOptions | undefined): number | undefined => retry?.count

const retryAllowanceOf = (retry: number | RetryOptions | undefined, fallback: number): number =>
  typeof retry === 'number' ? retry : withDefault(retryCountOf(retry), fallback)

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

const EMPTY_RUN_OPTIONS: DrainRunOptions = {}

interface AttemptFailure {
  readonly message: string
  readonly skipped: boolean
}

const attemptFailureOf = (message: string): AttemptFailure => ({ message, skipped: false })
const attemptSkipOf = (message: string): AttemptFailure => ({ message, skipped: true })

const NO_FAILURE: AttemptFailure | undefined = undefined

const continueOrFail = (
  failure: AttemptFailure | undefined,
  rest: () => Effect.Effect<AttemptFailure | undefined>,
): Effect.Effect<AttemptFailure | undefined> =>
  Option.match(Option.fromNullishOr(failure), {
    onNone: () => rest(),
    onSome: (present) => Effect.succeed(present),
  })

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

const requireAssertionsOf = (project: VmProjectConfig): boolean | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Option.fromNullishOr(project.expect), (present) => Option.fromNullishOr(present.requireAssertions)),
  )

const sequenceHooksOf = (project: VmProjectConfig): SequenceHooks | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Option.fromNullishOr(project.sequence), (present) => Option.fromNullishOr(present.hooks)),
  )

const projectValueOf = <A>(
  project: VmProjectConfig | undefined,
  pick: (present: VmProjectConfig) => A | undefined,
  fallback: A,
): A =>
  Option.getOrElse(
    Option.flatMap(Option.fromNullishOr(project), (present) => Option.fromNullishOr(pick(present))),
    () => fallback,
  )

const configOf = (project: VmProjectConfig | undefined): RunnerConfig => ({
  testTimeout: projectValueOf(project, (present) => present.testTimeout, 5000),
  hookTimeout: projectValueOf(project, (present) => present.hookTimeout, 10000),
  retry: projectValueOf(project, (present) => present.retry, 0),
  repeats: projectValueOf(project, (present) => present.repeats, 0),
  maxConcurrency: projectValueOf(project, (present) => present.maxConcurrency, 5),
  requireAssertions: projectValueOf(project, requireAssertionsOf, false),
  sequenceHooks: projectValueOf(project, sequenceHooksOf, 'stack'),
  restoreMocks: projectValueOf(project, (present) => present.restoreMocks, false),
  clearMocks: projectValueOf(project, (present) => present.clearMocks, false),
  mockReset: projectValueOf(project, (present) => present.mockReset, false),
  unstubGlobals: projectValueOf(project, (present) => present.unstubGlobals, false),
  unstubEnvs: projectValueOf(project, (present) => present.unstubEnvs, false),
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

const globalNamePatternOf = (): NamePattern | undefined => globalConfigOf()?.testNamePattern

interface TimeoutKind {
  readonly label: string
  readonly option: string
}

const timeoutKindOf = (isHook: boolean): TimeoutKind =>
  isHook ? { label: 'Hook', option: 'hookTimeout' } : { label: 'Test', option: 'testTimeout' }

const timeoutMessageOf = (isHook: boolean, timeoutMs: number): string => {
  const { label, option } = timeoutKindOf(isHook)
  return `${label} timed out in ${timeoutMs}ms.\nIf this is a long-running ${label.toLowerCase()}, pass a timeout value as the last argument or configure it globally with "${option}".`
}

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

const noTimeout = (timeoutMs: number | undefined): boolean => timeoutMs === undefined || timeoutMs <= 0

const unboundedTimeout = (timeoutMs: number | undefined): boolean =>
  noTimeout(timeoutMs) || timeoutMs === Number.POSITIVE_INFINITY

const boundedTimeout = <A>(
  effect: Effect.Effect<A>,
  timeoutMs: number,
  onTimeout: () => void,
): Effect.Effect<A, AttemptFailure> =>
  Effect.flatMap(Effect.timeoutOption(effect, timeoutMs), (option) =>
    Option.isSome(option)
      ? Effect.succeed(option.value)
      : Effect.flatMap(Effect.sync(onTimeout), () => Effect.fail(attemptFailureOf(''))))

const timeoutOf = <A>(
  effect: Effect.Effect<A>,
  timeoutMs: number | undefined,
  onTimeout: () => void,
): Effect.Effect<A, AttemptFailure> =>
  unboundedTimeout(timeoutMs)
    ? effect
    : boundedTimeout(effect, withDefault(timeoutMs, 0), onTimeout)

export type HookCleanup = () => void | Promise<void>

interface FireOutcome {
  readonly value: HookCleanup | undefined
  readonly failure: AttemptFailure | undefined
}

interface HookSequence {
  readonly cleanups: ReadonlyArray<HookCleanup>
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

const appendCleanup = (acc: ReadonlyArray<HookCleanup>, value: HookCleanup | undefined): ReadonlyArray<HookCleanup> =>
  isCleanup(value) ? [...acc, value] : acc

const fireSequentially = (
  remaining: ReadonlyArray<RegisteredHook>,
  context: HarnessTestContext,
  defaultTimeoutMs: number,
  acc: ReadonlyArray<HookCleanup>,
): Effect.Effect<HookSequence> => {
  const step = (outcome: FireOutcome): Effect.Effect<HookSequence> =>
    outcome.failure !== undefined
      ? Effect.succeed({ cleanups: acc, failure: outcome.failure })
      : fireSequentially(remaining.slice(1), context, defaultTimeoutMs, appendCleanup(acc, outcome.value))
  return Option.match(firstOf(remaining), {
    onNone: () => Effect.succeed({ cleanups: acc, failure: undefined }),
    onSome: (hook) => Effect.flatMap(fireHook(hook, context, defaultTimeoutMs), step),
  })
}

const fireHookSequence = (
  registered: ReadonlyArray<RegisteredHook>,
  context: HarnessTestContext,
  defaultTimeoutMs: number,
): Effect.Effect<HookSequence> => fireSequentially(registered, context, defaultTimeoutMs, [])

const asRegisteredHook = (hook: RegisteredHook | RegisteredHook['fn']): RegisteredHook =>
  typeof hook === 'function' ? { fn: hook, timeout: undefined } : hook

const runTaskHooks = (
  registered: ReadonlyArray<RegisteredHook | RegisteredHook['fn']>,
  context: HarnessTestContext,
  defaultTimeoutMs: number,
): Effect.Effect<AttemptFailure | undefined> =>
  Effect.map(
    Effect.forEach(
      [...registered].reverse(),
      (hook) => fireHook(asRegisteredHook(hook), context, defaultTimeoutMs),
    ),
    firstFailureOf,
  )

type FinishAround = (primary: AttemptFailure | undefined, secondary: AttemptFailure | undefined) => void

interface AroundResolvers {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

interface AroundState {
  settled: boolean
  runCalled: boolean
  innerFailure: AttemptFailure | undefined
  readonly innerGate: AroundResolvers
}

const settleAround = (
  state: AroundState,
  resume: (effect: Effect.Effect<AttemptFailure | undefined, never>) => void,
  primary: AttemptFailure | undefined,
  secondary: AttemptFailure | undefined,
): void => {
  if (state.settled) {
    return
  }
  state.settled = true
  resume(Effect.succeed(firstKnown(primary, secondary)))
}

const invokeAroundHook = (
  registration: AroundRegistration,
  context: HarnessTestContext,
  state: AroundState,
  run: () => Promise<void>,
): Promise<void> =>
  Promise.resolve()
    .then(() =>
      registration.hook(() => {
        state.runCalled = true
        const promised = Promise.resolve().then(run)
        void promised.then(() => state.innerGate.promise)
        return promised
      }, context)
    )
    .then(() => undefined)

const runInnerToGate = (
  runInner: () => Effect.Effect<AttemptFailure | undefined>,
  effectContext: Context.Context<never>,
  state: AroundState,
): Promise<void> => {
  void Effect.runPromiseWith(effectContext)(
    Effect.matchEffect(runInner(), {
      onFailure: (failure) =>
        Effect.sync(() => {
          state.innerFailure = failure
        }),
      onSuccess: () => Effect.void,
    }),
  ).then(() => state.innerGate.resolve(), () => state.innerGate.resolve())
  return state.innerGate.promise
}

const finishAroundCalled = (
  state: AroundState,
  callbackName: string,
  hookName: string,
  finish: FinishAround,
): void => {
  if (!state.runCalled) {
    finish(attemptFailureOf(notCalledMessageOf(callbackName, hookName)), undefined)
    return
  }
  finish(state.innerFailure, undefined)
}

const aroundRun = (
  registration: AroundRegistration,
  context: HarnessTestContext,
  callbackName: string,
  hookName: string,
  runInner: () => Effect.Effect<AttemptFailure | undefined>,
  effectContext: Context.Context<never>,
): Effect.Effect<AttemptFailure | undefined, never> =>
  Effect.callback<AttemptFailure | undefined, never>((resume) => {
    const state: AroundState = {
      settled: false,
      runCalled: false,
      innerFailure: undefined,
      innerGate: Promise.withResolvers<void>(),
    }
    const finish: FinishAround = (primary, secondary) => settleAround(state, resume, primary, secondary)
    const run = (): Promise<void> => runInnerToGate(runInner, effectContext, state)
    invokeAroundHook(registration, context, state, run).then(
      () => finishAroundCalled(state, callbackName, hookName, finish),
      <A = unknown>(cause: A) => {
        finish(attemptFailureOf(messageOf(cause)), state.innerFailure)
      },
    )
  })

const applyAroundTimeout = (
  hooked: Effect.Effect<AttemptFailure | undefined>,
  timeoutMs: number,
  callbackName: string,
  hookName: string,
): Effect.Effect<AttemptFailure | undefined> =>
  unboundedTimeout(timeoutMs)
    ? hooked
    : Effect.race(
      hooked,
      Effect.map(Effect.sleep(Duration.millis(timeoutMs)), () =>
        attemptFailureOf(aroundTimeoutMessageOf(callbackName, hookName, timeoutMs))),
    )

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
    const effectContext = yield* Effect.context()
    const hooked = aroundRun(registration, context, callbackName, hookName, runInner, effectContext)
    return yield* applyAroundTimeout(hooked, timeoutMs, callbackName, hookName)
  })

const isCallableFixture = (fixture: FixtureDefinition): boolean =>
  fixture.value !== null && typeof fixture.value === 'function'

const visitDep = (
  depName: string,
  fixture: FixtureDefinition,
  seen: ReadonlyArray<FixtureDefinition>,
  pending: Array<FixtureDefinition>,
  registrations: ReadonlyMap<string, FixtureDefinition>,
): void => {
  const replacement = depName === fixture.name ? fixture.parent : registrations.get(depName)
  Option.match(Option.fromNullishOr(replacement), {
    onNone: () => undefined,
    onSome: (present) => visitFixture(present, seen, pending, registrations),
  })
}

const forEachDep = (
  fixture: FixtureDefinition,
  seen: ReadonlyArray<FixtureDefinition>,
  pending: Array<FixtureDefinition>,
  registrations: ReadonlyMap<string, FixtureDefinition>,
): void => {
  for (const depName of fixture.deps) {
    visitDep(depName, fixture, seen, pending, registrations)
  }
}

const visitDeps = (
  fixture: FixtureDefinition,
  seen: ReadonlyArray<FixtureDefinition>,
  pending: Array<FixtureDefinition>,
  registrations: ReadonlyMap<string, FixtureDefinition>,
): void =>
  Match.value(isCallableFixture(fixture)).pipe(
    Match.when(false, () => undefined),
    Match.when(true, () => forEachDep(fixture, seen, pending, registrations)),
    Match.exhaustive,
  )

const revisitAncestor = (
  fixture: FixtureDefinition,
  seen: ReadonlyArray<FixtureDefinition>,
  pending: Array<FixtureDefinition>,
  registrations: ReadonlyMap<string, FixtureDefinition>,
): void => {
  if (fixture.parent === undefined) {
    throw new Error(`Circular fixture dependency detected: ${fixture.name}`)
  }
  visitFixture(fixture.parent, seen, pending, registrations)
}

const resolveSeenFixture = (
  fixture: FixtureDefinition,
  seen: ReadonlyArray<FixtureDefinition>,
  pending: Array<FixtureDefinition>,
  registrations: ReadonlyMap<string, FixtureDefinition>,
): void => {
  if (seen.includes(fixture)) {
    revisitAncestor(fixture, seen, pending, registrations)
    return
  }
  visitDeps(fixture, seen, pending, registrations)
}

const visitFixture = (
  fixture: FixtureDefinition,
  seen: ReadonlyArray<FixtureDefinition>,
  pending: Array<FixtureDefinition>,
  registrations: ReadonlyMap<string, FixtureDefinition>,
): void => {
  if (pending.includes(fixture)) {
    return
  }
  resolveSeenFixture(fixture, seen, pending, registrations)
  pending.push(fixture)
}

const resolveDepsOf = (
  used: ReadonlyArray<FixtureDefinition>,
  registrations: ReadonlyMap<string, FixtureDefinition>,
): ReadonlyArray<FixtureDefinition> => {
  const pending: Array<FixtureDefinition> = []
  for (const fixture of used) {
    visitFixture(fixture, [], pending, registrations)
  }
  return pending
}

function assertHookContext(_target: object): asserts _target is HarnessTestContext {}

const asHookContext = (target: object): HarnessTestContext => {
  assertHookContext(target)
  return target
}

interface RunnerNode {
  readonly suite: RegisteredSuite | undefined
  readonly planned: PlannedTest | undefined
  readonly children: Array<RunnerNode>
  readonly concurrent: boolean
  readonly order: number
}

interface FileTree {
  readonly children: Array<RunnerNode>
}

interface ChildBucket {
  readonly concurrent: boolean
  readonly nodes: ReadonlyArray<RunnerNode>
}

interface AttemptLadder {
  readonly failure: AttemptFailure | undefined
  readonly firstFailure: AttemptFailure | undefined
  readonly skipped: boolean
}

export const executeDrainRegistry: {
  (
    timeoutMs: number | undefined,
    runOptions?: DrainRunOptions,
  ): (registry: TestRegistry) => Promise<DrainOutcome>
  (
    registry: TestRegistry,
    timeoutMs: number | undefined,
    runOptions?: DrainRunOptions,
  ): Promise<DrainOutcome>
} = dual(
  (args: IArguments): boolean => typeof args[0] === 'object',
  (registry: TestRegistry, timeoutMs: number | undefined, runOptions?: DrainRunOptions): Promise<DrainOutcome> =>
    Effect.gen(function*() {
      const options = withDefault(runOptions, EMPTY_RUN_OPTIONS)
      const plan = skippedByNamePattern(
        planWithinFilter(
          planRun(registry, { allowOnly: true, allowOnlyFor: options.allowOnlyFor }),
          options.testFilter,
        ),
        globalNamePatternOf(),
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

      let fileNodes = HashMap.empty<string, FileTree>()
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

      const byId = (first: RegisteredSuite, second: RegisteredSuite): number => first.id - second.id
      const byOrder = (first: RunnerNode, second: RunnerNode): number => first.order - second.order

      const sortedSuites = (): ReadonlyArray<RegisteredSuite> => [...registry.suites.values()].sort(byId)

      const attachToParentNode = (node: RunnerNode, parentId: number): void => {
        Option.match(HashMap.get(buildNodes, parentId), {
          onNone: () => undefined,
          onSome: (parent) => {
            parent.children.push(node)
          },
        })
      }

      const attachNode = (node: RunnerNode, parentId: number | undefined, file: string): void => {
        if (parentId === undefined) {
          childrenOf(file).push(node)
          return
        }
        attachToParentNode(node, parentId)
      }

      const insertSuiteNode = (suite: RegisteredSuite): void => {
        const node: RunnerNode = {
          suite,
          planned: undefined,
          children: [],
          concurrent: suite.concurrent,
          order: suite.order,
        }
        buildNodes = HashMap.set(buildNodes, suite.id, node)
        attachNode(node, suite.parentIds.at(-1), suite.view.file.filepath)
      }

      const insertPlannedNode = (planned: PlannedTest): void => {
        const testNode: RunnerNode = {
          suite: undefined,
          planned,
          children: [],
          concurrent: planned.test.concurrent,
          order: planned.test.order,
        }
        attachNode(testNode, planned.chain.at(-1), planned.test.file)
      }

      const buildSuiteNodes = (): void => {
        for (const suite of sortedSuites()) {
          insertSuiteNode(suite)
        }
      }
      const buildPlannedNodes = (): void => {
        for (const planned of plan) {
          insertPlannedNode(planned)
        }
      }
      const sortFileTrees = (): void => {
        for (const tree of fileNodes.pipe(HashMap.values)) {
          tree.children.sort(byOrder)
        }
      }
      const sortBuildNodes = (): void => {
        for (const node of buildNodes.pipe(HashMap.values)) {
          node.children.sort(byOrder)
        }
      }
      const buildRunnerTrees = (): void => {
        buildSuiteNodes()
        buildPlannedNodes()
        sortFileTrees()
        sortBuildNodes()
      }

      const hasRunnableChild = (node: RunnerNode): boolean =>
        node.planned !== undefined ? !node.planned.skipped : node.children.some(hasRunnableChild)

      let usedNamesOf = HashMap.empty<number, FixtureProps>()
      const storeUsedNames = (planned: PlannedTest, props: FixtureProps): FixtureProps => {
        usedNamesOf = HashMap.set(usedNamesOf, planned.test.seq, props)
        return props
      }
      const sourceOf = (planned: PlannedTest): string =>
        Option.getOrElse(Option.map(Option.fromNullishOr(planned.test.fn), (fn) => fn.toString()), () => '')
      const parsedUsedNames = (planned: PlannedTest): FixtureProps => usedFixtureProps(sourceOf(planned), 0)
      const computeUsedNames = (planned: PlannedTest): FixtureProps =>
        Option.match(Option.fromNullishOr(planned.test.fixtureNames), {
          onSome: (stored) => storeUsedNames(planned, Result.succeed(stored)),
          onNone: () => storeUsedNames(planned, parsedUsedNames(planned)),
        })
      const usedNamesFor = (planned: PlannedTest): FixtureProps =>
        Option.match(HashMap.get(usedNamesOf, planned.test.seq), {
          onSome: (cached) => cached,
          onNone: () => computeUsedNames(planned),
        })

      let fileContexts = HashMap.empty<string, object>()
      const fileContextOf = (file: string): object => {
        const existing = HashMap.get(fileContexts, file)
        if (Option.isSome(existing)) {
          return existing.value
        }
        const created: object = nullObject()
        fileContexts = HashMap.set(fileContexts, file, created)
        return created
      }
      const workerContext: object = nullObject()

      const scopedFixtureKey = (name: string): string => `fixture:${name}`

      const scopedContextOf = (fixture: FixtureDefinition, fileContext: object): object =>
        fixture.scope === 'worker' ? workerContext : fileContext

      const mergedContextOf = (fixture: FixtureDefinition, scopedContext: object): object =>
        fixture.scope === 'file' ? Object.assign(nullObject(), scopedContext) : scopedContext

      const applyStaticFixture = (task: RunnerTest, fixture: FixtureDefinition): undefined => {
        Reflect.set(task.context, fixture.name, fixture.value)
        return undefined
      }

      const setTaskFixtureValue = (
        task: RunnerTest,
        fixture: FixtureDefinition,
        attempted: Result.Result<FixtureValue, string>,
      ): Effect.Effect<AttemptFailure | undefined> => {
        return Result.isFailure(attempted)
          ? Effect.succeed(attemptFailureOf(attempted.failure))
          : Effect.sync(() => {
            Reflect.set(task.context, fixture.name, attempted.success)
            return undefined
          })
      }

      const reuseScopedFixture = (
        task: RunnerTest,
        fixture: FixtureDefinition,
        scopedContext: object,
        key: string,
      ): undefined => {
        Reflect.set(task.context, fixture.name, Reflect.get(scopedContext, key))
        return undefined
      }

      const storeScopedFixture = (
        task: RunnerTest,
        fixture: FixtureDefinition,
        scopedContext: object,
        key: string,
        attempted: Result.Result<FixtureValue, string>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Result.isFailure(attempted)
          ? Effect.succeed(attemptFailureOf(attempted.failure))
          : Effect.sync(() => {
            Reflect.set(scopedContext, key, attempted.success)
            Reflect.set(task.context, fixture.name, attempted.success)
            return undefined
          })

      const applyNewScopedFixture = (
        task: RunnerTest,
        fixture: FixtureDefinition,
        scopedContext: object,
        key: string,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.flatMap(
          Effect.result(
            resolveFixtureValue(fixture, mergedContextOf(fixture, scopedContext), cleanupArrayOf(scopedContext)),
          ),
          (attempted) => storeScopedFixture(task, fixture, scopedContext, key, attempted),
        )

      const applyTestScopedFixture = (
        task: RunnerTest,
        fixture: FixtureDefinition,
        clean: Array<() => Promise<void>>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.flatMap(
          Effect.result(resolveFixtureValue(fixture, task.context, clean)),
          (attempted) => setTaskFixtureValue(task, fixture, attempted),
        )

      const applyScopedFixture = (
        task: RunnerTest,
        fixture: FixtureDefinition,
        fileContext: object,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.gen(function*() {
          const scopedContext = scopedContextOf(fixture, fileContext)
          const key = scopedFixtureKey(fixture.name)
          return yield* (Reflect.has(scopedContext, key)
            ? Effect.succeed(reuseScopedFixture(task, fixture, scopedContext, key))
            : applyNewScopedFixture(task, fixture, scopedContext, key))
        })

      const applyCallableFixture = (
        task: RunnerTest,
        fixture: FixtureDefinition,
        fileContext: object,
        clean: Array<() => Promise<void>>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        fixture.scope === 'test'
          ? applyTestScopedFixture(task, fixture, clean)
          : applyScopedFixture(task, fixture, fileContext)

      const applyFixture = (
        task: RunnerTest,
        fixture: FixtureDefinition,
        fileContext: object,
        clean: Array<() => Promise<void>>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        isCallableFixture(fixture)
          ? applyCallableFixture(task, fixture, fileContext, clean)
          : Effect.succeed(applyStaticFixture(task, fixture))

      const suiteHostOf = (task: RunnerTest): FixtureHost | undefined =>
        Option.getOrElse(Option.fromNullishOr(task.suite), () => task.file)

      const registrationsFor = (planned: PlannedTest): Option.Option<ReadonlyMap<string, FixtureDefinition>> =>
        Option.filter(
          Option.map(
            Option.fromNullishOr(planned.test.fixtures),
            (fixtures) => definitionsFor(fixtures, suiteHostOf(planned.test.task)),
          ),
          (registrations) => registrations.size > 0,
        )

      const candidateFixtures = (
        registrations: ReadonlyMap<string, FixtureDefinition>,
        usedNames: ReadonlySet<string>,
      ): Option.Option<ReadonlyArray<FixtureDefinition>> =>
        Option.filter(
          Option.some([...registrations.values()].filter((fixture) => fixture.auto || usedNames.has(fixture.name))),
          (candidates) => candidates.length > 0,
        )

      const runFixtureSequence = (
        fixtures: ReadonlyArray<FixtureDefinition>,
        task: RunnerTest,
        fileContext: object,
        clean: Array<() => Promise<void>>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Option.match(firstOf(fixtures), {
          onNone: () => Effect.succeed(NO_FAILURE),
          onSome: (fixture) =>
            Effect.flatMap(applyFixture(task, fixture, fileContext, clean), (failure) =>
              continueOrFail(failure, () => runFixtureSequence(fixtures.slice(1), task, fileContext, clean))),
        })

      const runFixtureDeps = (
        planned: PlannedTest,
        fileContext: object,
        body: () => Effect.Effect<AttemptFailure | undefined>,
        registrations: ReadonlyMap<string, FixtureDefinition>,
        candidates: ReadonlyArray<FixtureDefinition>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.flatMap(
          runFixtureSequence(
            resolveDepsOf(candidates, registrations),
            planned.test.task,
            fileContext,
            cleanupArrayOf(planned.test.task.context),
          ),
          (failure) => continueOrFail(failure, body),
        )

      const runFixtureCandidates = (
        planned: PlannedTest,
        fileContext: object,
        body: () => Effect.Effect<AttemptFailure | undefined>,
        registrations: ReadonlyMap<string, FixtureDefinition>,
        usedNames: ReadonlySet<string>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Option.match(candidateFixtures(registrations, usedNames), {
          onNone: () => body(),
          onSome: (candidates) => runFixtureDeps(planned, fileContext, body, registrations, candidates),
        })

      const resolveRegisteredFixtures = (
        planned: PlannedTest,
        fileContext: object,
        body: () => Effect.Effect<AttemptFailure | undefined>,
        registrations: ReadonlyMap<string, FixtureDefinition>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Result.match(usedNamesFor(planned), {
          onFailure: (rejection) => Effect.succeed(attemptFailureOf(rejection.reason)),
          onSuccess: (usedNames) => runFixtureCandidates(planned, fileContext, body, registrations, usedNames),
        })

      const resolveFixturesFor = (
        planned: PlannedTest,
        fileContext: object,
        body: () => Effect.Effect<AttemptFailure | undefined>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Option.match(registrationsFor(planned), {
          onNone: () => body(),
          onSome: (registrations) => resolveRegisteredFixtures(planned, fileContext, body, registrations),
        })

      const noAssertions = (state: ExpectState): boolean => state.assertionCalls === 0

      const expectedCountMismatch = (state: ExpectState): number | undefined =>
        Option.getOrUndefined(
          Option.filter(
            Option.fromNullishOr(state.expectedAssertionsNumber),
            (expected) => state.assertionCalls !== expected,
          ),
        )

      const noneAssertionsFailure = (): AttemptFailure =>
        attemptFailureOf('expected any number of assertion, but got none')

      const expectedCountFailure = (state: ExpectState): AttemptFailure | undefined =>
        Option.match(Option.fromNullishOr(expectedCountMismatch(state)), {
          onNone: () => undefined,
          onSome: (expected) =>
            attemptFailureOf(
              `expected number of assertions to be ${String(expected)}, but got ${String(state.assertionCalls)}`,
            ),
        })

      const expectingButNone = (state: ExpectState): boolean =>
        state.isExpectingAssertions === true && noAssertions(state)

      const expectingAssertionsFailure = (state: ExpectState): AttemptFailure | undefined =>
        expectingButNone(state) ? noneAssertionsFailure() : undefined

      const requireButNone = (state: ExpectState): boolean => config.requireAssertions && noAssertions(state)

      const requireAssertionsFailure = (state: ExpectState): AttemptFailure | undefined =>
        requireButNone(state) ? noneAssertionsFailure() : undefined

      const assertionFailureFrom = (state: ExpectState): AttemptFailure | undefined =>
        firstKnown(
          expectedCountFailure(state),
          firstKnown(expectingAssertionsFailure(state), requireAssertionsFailure(state)),
        )

      const assertionFailureOf = (): AttemptFailure | undefined =>
        Option.match(Option.fromNullishOr(expectStateOf()), {
          onNone: () => undefined,
          onSome: (state) => assertionFailureFrom(state),
        })

      const errorsOf = (task: RunnerTest): ReadonlyArray<TaskError> =>
        Option.getOrElse(
          Option.flatMap(Option.fromNullishOr(task.result), (result) => Option.fromNullishOr(result.errors)),
          () => [],
        )

      const failingErrors = (task: RunnerTest): ReadonlyArray<TaskError> =>
        Option.getOrElse(
          Option.flatMap(
            Option.filter(Option.fromNullishOr(task.result), (result) => result.state === 'fail'),
            (result) => Option.fromNullishOr(result.errors),
          ),
          () => [],
        )

      const failingErrorOf = (task: RunnerTest): TaskError | undefined =>
        Option.getOrUndefined(Option.fromNullishOr(failingErrors(task)[0]))

      const softFailureOf = (task: RunnerTest): AttemptFailure | undefined =>
        Option.match(Option.fromNullishOr(failingErrorOf(task)), {
          onNone: () => undefined,
          onSome: (error) => attemptFailureOf(error.message),
        })

      const testTimeoutOf = (task: RunnerTest): number => withDefault(task.timeout, config.testTimeout)

      const nonBlankFailure = (failure: AttemptFailure | undefined): AttemptFailure | undefined =>
        Option.getOrUndefined(
          Option.filter(Option.fromNullishOr(failure), (present) => present.message !== ''),
        )

      const timedOutOrFailure = (
        result: Result.Result<AttemptFailure | undefined, AttemptFailure>,
        timeoutMs: number,
      ): AttemptFailure | undefined =>
        Result.isFailure(result)
          ? attemptFailureOf(timeoutMessageOf(false, timeoutMs))
          : nonBlankFailure(result.success)

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
          (result) => timedOutOrFailure(result, timeoutMs),
        )
      }

      const hooksOf = (sets: HookSets | undefined): ReadonlyArray<RegisteredHook> =>
        withDefault(Option.getOrUndefined(Option.map(Option.fromNullishOr(sets), (present) => present.afterEach)), [])

      const suiteAfterEachOf = (id: number): ReadonlyArray<RegisteredHook> => hooksOf(registry.suiteHooks.get(id))

      const rootAfterEachOf = (file: string): ReadonlyArray<RegisteredHook> => hooksOf(registry.rootHooks.get(file))

      const suiteHooksAfterEach = (planned: PlannedTest): ReadonlyArray<RegisteredHook> => [
        ...[...planned.chain].reverse().flatMap((id) => afterHooksFor(config, suiteAfterEachOf(id))),
        ...afterHooksFor(config, rootAfterEachOf(planned.test.file)),
      ]

      const runCleanupFns = (cleanups: ReadonlyArray<HookCleanup>): Effect.Effect<void> =>
        Effect.forEach(
          [...cleanups].reverse(),
          (cleanup) => Effect.promise(() => Promise.resolve().then(() => cleanup())),
          { discard: true },
        )

      const runHookList = (
        hooks: ReadonlyArray<RegisteredHook>,
        view: HarnessTestContext,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Option.match(firstOf(hooks), {
          onNone: () => Effect.succeed(NO_FAILURE),
          onSome: (hook) =>
            Effect.flatMap(fireHook(hook, view, config.hookTimeout), (outcome) =>
              continueOrFail(outcome.failure, () => runHookList(hooks.slice(1), view))),
        })

      const runFinishHooks = (
        task: RunnerTest,
        context: HarnessTestContext,
        failure: AttemptFailure | undefined,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.gen(function*() {
          const finished = yield* runTaskHooks(withDefault(task.onFinished, []), context, config.hookTimeout)
          task.onFinished = undefined
          yield* runFailedHooksWhenNeeded(task, context, failure)
          task.onFailed = undefined
          return firstKnown(finished, failure)
        })

      const shouldRunFailedHooks = (task: RunnerTest, failure: AttemptFailure | undefined): boolean =>
        failure !== undefined && withDefault(task.onFailed, []).length > 0

      const runFailedHooksWhenNeeded = (
        task: RunnerTest,
        context: HarnessTestContext,
        failure: AttemptFailure | undefined,
      ): Effect.Effect<void> =>
        shouldRunFailedHooks(task, failure)
          ? Effect.asVoid(runTaskHooks(withDefault(task.onFailed, []), context, config.hookTimeout))
          : Effect.void

      const firstPresentFailure = (
        bodyFailure: AttemptFailure | undefined,
        task: RunnerTest,
      ): AttemptFailure | undefined => firstKnown(firstKnown(bodyFailure, softFailureOf(task)), assertionFailureOf())

      const runAfterEachPhases = (
        planned: PlannedTest,
        task: RunnerTest,
        context: HarnessTestContext,
        before: HookSequence,
        fixtureBase: number,
        failure: AttemptFailure | undefined,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.gen(function*() {
          const afterEachFailure = yield* runHookList(suiteHooksAfterEach(planned), context)
          if (afterEachFailure !== undefined) {
            return afterEachFailure
          }
          yield* runCleanupFns(before.cleanups)
          yield* cleanupFrom(context, fixtureBase)
          return yield* runFinishHooks(task, context, failure)
        })

      const runTestPhases = (
        planned: PlannedTest,
        fileContext: object,
        task: RunnerTest,
        context: HarnessTestContext,
        before: HookSequence,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.gen(function*() {
          const fixtureBase = cleanupCountOf(context)
          const bodyFailure = yield* resolveFixturesFor(planned, fileContext, () =>
            runBodyFor(planned, testTimeoutOf(task)))
          const failure = firstPresentFailure(bodyFailure, task)
          return yield* runAfterEachPhases(planned, task, context, before, fixtureBase, failure)
        })

      const runAttemptInner = (
        planned: PlannedTest,
        fileContext: object,
      ): Effect.Effect<AttemptFailure | undefined> => {
        const task = planned.test.task
        const context = task.context
        return Effect.gen(function*() {
          const before = yield* fireHookSequence(
            hooksFor(registry, 'beforeEach', planned.chain, planned.test.file),
            context,
            config.hookTimeout,
          )
          if (before.failure !== undefined) {
            return before.failure
          }
          return yield* runTestPhases(planned, fileContext, task, context, before)
        })
      }

      const runTestAroundChain = (
        aroundChain: ReadonlyArray<AroundRegistration>,
        context: HarnessTestContext,
        runInner: () => Effect.Effect<AttemptFailure | undefined>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Option.match(firstOf(aroundChain), {
          onNone: () => runInner(),
          onSome: (registration) =>
            runAroundHook(registration, context, config.hookTimeout, 'runTest()', 'aroundEach', () =>
              runTestAroundChain(aroundChain.slice(1), context, runInner)),
        })

      const runAttempt = (
        planned: PlannedTest,
        fileContext: object,
        aroundChain: ReadonlyArray<AroundRegistration>,
      ): Effect.Effect<AttemptFailure | undefined> => {
        const task = planned.test.task
        const context = task.context
        const runInner = (): Effect.Effect<AttemptFailure | undefined> => runAttemptInner(planned, fileContext)
        return runTestAroundChain(aroundChain, context, runInner)
      }

      const isInverted = (planned: PlannedTest): boolean => planned.test.inverted

      const isSyntaxError = (error: TaskError): boolean => error.name === 'TestSyntaxError'

      const hasSyntaxFailure = (task: RunnerTest): boolean => errorsOf(task).some(isSyntaxError)

      const bypassInversion = (planned: PlannedTest, task: RunnerTest): boolean =>
        !isInverted(planned) || hasSyntaxFailure(task)

      const invertedOutcome = (failure: AttemptFailure | undefined): AttemptFailure | undefined =>
        failure === undefined ? attemptFailureOf('Expect test to fail') : undefined

      const invertIfNeeded = (
        planned: PlannedTest,
        task: RunnerTest,
        failure: AttemptFailure | undefined,
      ): AttemptFailure | undefined => bypassInversion(planned, task) ? failure : invertedOutcome(failure)

      const runSingleAttempt = (
        planned: PlannedTest,
        fileContext: object,
        task: RunnerTest,
        aroundChain: ReadonlyArray<AroundRegistration>,
        repeatIndex: number,
        retryIndex: number,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.gen(function*() {
          task.result = {
            state: 'run',
            startTime: hostNowMillis(),
            duration: undefined,
            retryCount: retryIndex,
            repeatCount: repeatIndex,
            errors: undefined,
            note: undefined,
            pending: undefined,
          }
          resetExpectStateFor(task)
          mockResetConfigOf(config)
          return yield* runAttempt(planned, fileContext, aroundChain)
        })

      const emptyLadder = (): AttemptLadder => ({ failure: undefined, firstFailure: undefined, skipped: false })

      const advancedLadder = (ladder: AttemptLadder, failure: AttemptFailure | undefined): AttemptLadder => ({
        failure,
        firstFailure: firstKnown(ladder.firstFailure, failure),
        skipped: false,
      })

      const retryContinue = (
        planned: PlannedTest,
        fileContext: object,
        task: RunnerTest,
        aroundChain: ReadonlyArray<AroundRegistration>,
        retry: number,
        repeatIndex: number,
        retryIndex: number,
        ladder: AttemptLadder,
        failure: AttemptFailure | undefined,
      ): Effect.Effect<AttemptLadder> =>
        failure === undefined
          ? Effect.succeed(advancedLadder(ladder, failure))
          : runRetryAt(
            planned,
            fileContext,
            task,
            aroundChain,
            retry,
            repeatIndex,
            retryIndex + 1,
            advancedLadder(ladder, failure),
          )

      const retryStepLadder = (
        planned: PlannedTest,
        fileContext: object,
        task: RunnerTest,
        aroundChain: ReadonlyArray<AroundRegistration>,
        retry: number,
        repeatIndex: number,
        retryIndex: number,
        ladder: AttemptLadder,
        failure: AttemptFailure | undefined,
      ): Effect.Effect<AttemptLadder> =>
        isSkippedFailure(failure)
          ? Effect.succeed({ failure, firstFailure: ladder.firstFailure, skipped: true })
          : retryContinue(
            planned,
            fileContext,
            task,
            aroundChain,
            retry,
            repeatIndex,
            retryIndex,
            ladder,
            failure,
          )

      const runRetryAt = (
        planned: PlannedTest,
        fileContext: object,
        task: RunnerTest,
        aroundChain: ReadonlyArray<AroundRegistration>,
        retry: number,
        repeatIndex: number,
        retryIndex: number,
        ladder: AttemptLadder,
      ): Effect.Effect<AttemptLadder> =>
        retryIndex > retry
          ? Effect.succeed(ladder)
          : Effect.flatMap(
            runSingleAttempt(planned, fileContext, task, aroundChain, repeatIndex, retryIndex),
            (failure) =>
              retryStepLadder(
                planned,
                fileContext,
                task,
                aroundChain,
                retry,
                repeatIndex,
                retryIndex,
                ladder,
                failure,
              ),
          )

      const continueRepeat = (
        planned: PlannedTest,
        fileContext: object,
        task: RunnerTest,
        aroundChain: ReadonlyArray<AroundRegistration>,
        repeats: number,
        retry: number,
        repeatIndex: number,
        nextLadder: AttemptLadder,
      ): Effect.Effect<AttemptLadder> =>
        nextLadder.skipped
          ? Effect.succeed(nextLadder)
          : runRepeatAt(
            planned,
            fileContext,
            task,
            aroundChain,
            repeats,
            retry,
            repeatIndex + 1,
            nextLadder,
          )

      const runRepeatAt = (
        planned: PlannedTest,
        fileContext: object,
        task: RunnerTest,
        aroundChain: ReadonlyArray<AroundRegistration>,
        repeats: number,
        retry: number,
        repeatIndex: number,
        ladder: AttemptLadder,
      ): Effect.Effect<AttemptLadder> =>
        repeatIndex > repeats
          ? Effect.succeed(ladder)
          : Effect.flatMap(
            runRetryAt(planned, fileContext, task, aroundChain, retry, repeatIndex, 0, ladder),
            (nextLadder) =>
              continueRepeat(planned, fileContext, task, aroundChain, repeats, retry, repeatIndex, nextLadder),
          )

      const runRepeatCycles = (
        planned: PlannedTest,
        fileContext: object,
        task: RunnerTest,
        aroundChain: ReadonlyArray<AroundRegistration>,
      ): Effect.Effect<AttemptLadder> => {
        const repeats = withDefault(task.repeats, config.repeats)
        const retry = retryAllowanceOf(task.retry, config.retry)
        return runRepeatAt(planned, fileContext, task, aroundChain, repeats, retry, 0, emptyLadder())
      }

      const fallbackToFirst = (task: RunnerTest, ladder: AttemptLadder): boolean =>
        ladder.failure === undefined && withDefault(task.repeats, config.repeats) > 0

      const ladderResultFailure = (task: RunnerTest, ladder: AttemptLadder): AttemptFailure | undefined =>
        fallbackToFirst(task, ladder) ? ladder.firstFailure : ladder.failure

      const ladderOutcome = (
        planned: PlannedTest,
        task: RunnerTest,
        ladder: AttemptLadder,
      ): Effect.Effect<AttemptFailure | undefined> =>
        ladder.skipped
          ? Effect.succeed(ladder.failure)
          : Effect.succeed(invertIfNeeded(planned, task, ladderResultFailure(task, ladder)))

      const runAttemptCycle = (
        planned: PlannedTest,
        fileContext: object,
      ): Effect.Effect<AttemptFailure | undefined> => {
        const task = planned.test.task
        const aroundChain = aroundEachHooksFor(registry, planned.chain, planned.test.file)
        return Effect.flatMap(
          runRepeatCycles(planned, fileContext, task, aroundChain),
          (ladder) => ladderOutcome(planned, task, ladder),
        )
      }

      const skipTest = (planned: PlannedTest): boolean => planned.skipped || planned.refusedOnly

      const testStatusInputOf = (failure: AttemptFailure | undefined, timeSpentMs: number): TestOutcome => ({
        failureMessage: attemptMessageOf(failure),
        timeSpentMs,
        skipped: isSkippedFailure(failure),
      })

      const skipMessage = (failure: AttemptFailure | undefined): boolean => failure === undefined || failure.skipped

      const storedFailureMessage = (failure: AttemptFailure | undefined): string | undefined =>
        skipMessage(failure) ? undefined : attemptMessageOf(failure)

      const storedOutcomeOf = (failure: AttemptFailure | undefined, timeSpentMs: number): TestOutcome => ({
        failureMessage: storedFailureMessage(failure),
        timeSpentMs,
        skipped: isSkippedFailure(failure),
      })

      const runOneTest = (planned: PlannedTest, fileContext: object): Effect.Effect<void> =>
        Effect.gen(function*() {
          if (skipTest(planned)) {
            return
          }
          const task = planned.test.task
          const startedAt = hostNowMillis()
          setWorkerCurrentTask(task)
          registry.currentTest = task.context
          const ref: DrainTestRef = { id: testIdOf(planned), name: planned.fullName, file: planned.test.file }
          yield* fireStage(options.beforeTest, ref)

          const failure = yield* runAttemptCycle(planned, fileContext)
          const timeSpentMs = hostNowMillis() - startedAt
          const status: DrainedStatus = decideTestStatus(testStatusInputOf(failure, timeSpentMs), {
            inverted: planned.test.inverted,
            fullName: planned.fullName,
          }).status
          storeOutcome(planned, storedOutcomeOf(failure, timeSpentMs))

          yield* fireOutcomeStage(options.afterTest, ref, { status, failureMessage: attemptMessageOf(failure) })
          registry.currentTest = undefined
          setWorkerCurrentTask(undefined)
        })

      const isRunnablePlanned = (planned: PlannedTest | undefined): planned is PlannedTest =>
        planned !== undefined && !planned.skipped

      const markPlannedSkipped = (planned: PlannedTest): void => {
        storeOutcome(planned, { failureMessage: undefined, timeSpentMs: 0, skipped: true })
      }

      const visitChildren = (current: RunnerNode): void => {
        for (const child of current.children) {
          visitSkippedNode(child)
        }
      }

      const visitSkippedNode = (current: RunnerNode): void =>
        isRunnablePlanned(current.planned) ? markPlannedSkipped(current.planned) : visitChildren(current)

      const markChildrenSkipped = (node: RunnerNode): Effect.Effect<void> => Effect.sync(() => visitSkippedNode(node))

      const opensBucket = (last: ChildBucket | undefined, child: RunnerNode): boolean =>
        last === undefined || last.concurrent !== child.concurrent

      const appendToLastBucket = (buckets: Array<ChildBucket>, child: RunnerNode): void => {
        const last = buckets[buckets.length - 1]
        if (last !== undefined) {
          buckets[buckets.length - 1] = { concurrent: last.concurrent, nodes: [...last.nodes, child] }
        }
      }

      const addChildToBuckets = (buckets: Array<ChildBucket>, child: RunnerNode): void => {
        if (opensBucket(buckets.at(-1), child)) {
          buckets.push({ concurrent: child.concurrent, nodes: [child] })
          return
        }
        appendToLastBucket(buckets, child)
      }

      const bucketChildren = (children: ReadonlyArray<RunnerNode>): ReadonlyArray<ChildBucket> => {
        const buckets: Array<ChildBucket> = []
        for (const child of children) {
          addChildToBuckets(buckets, child)
        }
        return buckets
      }

      const ceilingOf = (pendingLength: number): number =>
        config.maxConcurrency <= 0 ? pendingLength : config.maxConcurrency

      const runSequentialChildren = (
        nodes: ReadonlyArray<RunnerNode>,
        file: string,
        fileContext: object,
      ): Effect.Effect<void> =>
        Effect.forEach(nodes, (child) => runSuiteNode(child, file, fileContext), { discard: true })

      const runSuiteNodeConcurrent = (child: RunnerNode, file: string, fileContext: object): Effect.Effect<void> =>
        Effect.flatMap(Effect.yieldNow, () => runSuiteNode(child, file, fileContext))

      const runConcurrentChildren = (
        nodes: ReadonlyArray<RunnerNode>,
        ceiling: number,
        file: string,
        fileContext: object,
      ): Effect.Effect<void> =>
        nodes.length === 0
          ? Effect.void
          : Effect.gen(function*() {
            const head = nodes.slice(0, ceiling)
            const tail = nodes.slice(ceiling)
            yield* Effect.forEach(
              head,
              (child) => runSuiteNodeConcurrent(child, file, fileContext),
              { concurrency: 'unbounded', discard: true },
            )
            yield* runConcurrentChildren(tail, ceiling, file, fileContext)
          })

      const runChildBucket = (
        bucket: ChildBucket,
        file: string,
        fileContext: object,
      ): Effect.Effect<void> =>
        bucket.concurrent
          ? runConcurrentChildren(bucket.nodes, ceilingOf(bucket.nodes.length), file, fileContext)
          : runSequentialChildren(bucket.nodes, file, fileContext)

      const runChildrenNodes = (node: RunnerNode, file: string, fileContext: object): Effect.Effect<void> =>
        Effect.forEach(
          bucketChildren(node.children),
          (bucket) => runChildBucket(bucket, file, fileContext),
          { discard: true },
        )

      const suiteAroundOf = (suite: RegisteredSuite): ReadonlyArray<AroundRegistration> =>
        withDefault(
          Option.getOrUndefined(
            Option.map(Option.fromNullishOr(registry.suiteAround.get(suite.id)), (sets) => sets.aroundAll),
          ),
          [],
        )

      const suiteBeforeAllOf = (suite: RegisteredSuite): ReadonlyArray<RegisteredHook> =>
        withDefault(
          Option.getOrUndefined(
            Option.map(Option.fromNullishOr(registry.suiteHooks.get(suite.id)), (hooks) => hooks.beforeAll),
          ),
          [],
        )

      const suiteAfterAllOf = (suite: RegisteredSuite): ReadonlyArray<RegisteredHook> =>
        withDefault(
          Option.getOrUndefined(
            Option.map(Option.fromNullishOr(registry.suiteHooks.get(suite.id)), (hooks) => hooks.afterAll),
          ),
          [],
        )

      const suiteAroundChain = (
        registrations: ReadonlyArray<AroundRegistration>,
        view: HarnessTestContext,
        runInner: () => Effect.Effect<AttemptFailure | undefined>,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Option.match(firstOf(registrations), {
          onNone: () => runInner(),
          onSome: (registration) =>
            runAroundHook(registration, view, config.hookTimeout, 'runSuite()', 'aroundAll', () =>
              suiteAroundChain(registrations.slice(1), view, runInner)),
        })

      const shouldSkipChildren = (failure: AttemptFailure | undefined, childrenRan: boolean): boolean =>
        failure !== undefined && !childrenRan

      const skipChildrenWhenNotRun = (
        node: RunnerNode,
        failure: AttemptFailure | undefined,
        childrenRan: boolean,
      ): Effect.Effect<void> => shouldSkipChildren(failure, childrenRan) ? markChildrenSkipped(node) : Effect.void

      const runSuiteChildren = (
        state: { childrenRan: boolean },
        suite: RegisteredSuite,
        suiteView: HarnessTestContext,
        node: RunnerNode,
        file: string,
        fileContext: object,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.gen(function*() {
          const before = yield* fireHookSequence(suiteBeforeAllOf(suite), suiteView, config.hookTimeout)
          if (before.failure !== undefined) {
            return before.failure
          }
          state.childrenRan = true
          yield* runChildrenNodes(node, file, fileContext)
          yield* runCleanupFns(before.cleanups)
          return yield* runHookList(afterHooksFor(config, suiteAfterAllOf(suite)), suiteView)
        })

      const runSuiteChain = (
        suite: RegisteredSuite,
        node: RunnerNode,
        file: string,
        fileContext: object,
      ): Effect.Effect<void> =>
        Effect.gen(function*() {
          const suiteView = asHookContext(suite.view)
          const state = { childrenRan: false }
          const failure = yield* suiteAroundChain(suiteAroundOf(suite), suiteView, () =>
            runSuiteChildren(state, suite, suiteView, node, file, fileContext))
          yield* skipChildrenWhenNotRun(node, failure, state.childrenRan)
        })

      const runRunnableSuite = (
        suite: RegisteredSuite,
        node: RunnerNode,
        file: string,
        fileContext: object,
      ): Effect.Effect<void> => hasRunnableChild(node) ? runSuiteChain(suite, node, file, fileContext) : Effect.void

      const runSuiteBody = (node: RunnerNode, file: string, fileContext: object): Effect.Effect<void> =>
        Option.match(Option.fromNullishOr(node.suite), {
          onNone: () => Effect.void,
          onSome: (suite) => runRunnableSuite(suite, node, file, fileContext),
        })

      const runSuiteNode = (node: RunnerNode, file: string, fileContext: object): Effect.Effect<void> =>
        node.planned !== undefined
          ? runOneTest(node.planned, fileContext)
          : runSuiteBody(node, file, fileContext)

      const lateRejections: Array<string> = []
      const rejectionListener = <A = unknown>(cause: A): void => {
        lateRejections.push(messageOf(cause))
      }

      const rootHooksFor = (kind: HookKind, file: string): ReadonlyArray<RegisteredHook> =>
        withDefault(
          Option.getOrUndefined(Option.map(Option.fromNullishOr(registry.rootHooks.get(file)), (hooks) => hooks[kind])),
          [],
        )

      const fileAroundOf = (file: string): ReadonlyArray<AroundRegistration> =>
        withDefault(
          Option.getOrUndefined(
            Option.map(Option.fromNullishOr(registry.rootAround.get(file)), (sets) => sets.aroundAll),
          ),
          [],
        )

      const fileViewOf = (file: string): object =>
        Option.getOrElse(Option.fromNullishOr(registry.fileViews.get(file)), nullObject)

      const fileContextObjectOf = (file: string): object =>
        Option.getOrElse(HashMap.get(fileContexts, file), nullObject)

      const afterHookOutcome = (
        afterFailure: AttemptFailure | undefined,
        fileContext: object,
      ): Effect.Effect<AttemptFailure | undefined> =>
        afterFailure !== undefined
          ? Effect.succeed(afterFailure)
          : Effect.as(cleanupAll(fileContext), NO_FAILURE)

      const runFileBody = (
        cleanups: ReadonlyArray<HookCleanup>,
        fileView: HarnessTestContext,
        fileNode: RunnerNode,
        file: string,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.gen(function*() {
          yield* runChildrenNodes(fileNode, file, fileContextOf(file))
          yield* runCleanupFns(cleanups)
          const afterFailure = yield* runHookList(afterHooksFor(config, rootHooksFor('afterAll', file)), fileView)
          return yield* afterHookOutcome(afterFailure, fileContextObjectOf(file))
        })

      const skipChildrenAndReport = (
        failure: AttemptFailure,
        fileNode: RunnerNode,
      ): Effect.Effect<AttemptFailure | undefined> => Effect.map(markChildrenSkipped(fileNode), () => failure)

      const runFile = (
        file: string,
        fileView: HarnessTestContext,
        fileNode: RunnerNode,
      ): Effect.Effect<AttemptFailure | undefined> =>
        Effect.gen(function*() {
          const before = yield* fireHookSequence(rootHooksFor('beforeAll', file), fileView, config.hookTimeout)
          return yield* (before.failure !== undefined
            ? skipChildrenAndReport(before.failure, fileNode)
            : runFileBody(before.cleanups, fileView, fileNode, file))
        })

      const runEachAround = (
        registrations: ReadonlyArray<AroundRegistration>,
        view: HarnessTestContext,
        run: () => Effect.Effect<AttemptFailure | undefined>,
      ): Effect.Effect<void> =>
        Effect.gen(function*() {
          for (const registration of registrations) {
            yield* runAroundHook(registration, view, config.hookTimeout, 'runSuite()', 'aroundAll', run)
          }
        })

      const runFileAround = (
        file: string,
        fileView: HarnessTestContext,
        run: () => Effect.Effect<AttemptFailure | undefined>,
      ): Effect.Effect<void> =>
        Option.match(firstOf(fileAroundOf(file)), {
          onNone: () => Effect.asVoid(run()),
          onSome: () => runEachAround(fileAroundOf(file), fileView, run),
        })

      const runFileWithAround = (
        file: string,
        fileView: HarnessTestContext,
        fileNode: RunnerNode,
      ): Effect.Effect<void> => runFileAround(file, fileView, () => runFile(file, fileView, fileNode))

      const fileConfigOf = (file: string): VmProjectConfig | undefined =>
        options.configFor === undefined ? globalConfigOf() : options.configFor(file)

      const runIndexedFile = (
        file: string,
        tree: FileTree,
        index: number,
        total: number,
      ): Effect.Effect<void> =>
        Effect.gen(function*() {
          config = configOf(fileConfigOf(file))
          yield* fireStage(options.beforeFileRun, file)
          const fileNode: RunnerNode = {
            suite: undefined,
            planned: undefined,
            children: tree.children,
            concurrent: false,
            order: 0,
          }
          yield* runFileWithAround(file, asHookContext(fileViewOf(file)), fileNode)
          yield* fireOutcomeStage(options.afterFileRun, file, index === total - 1)
          yield* Effect.sync(restoreRealTimers)
        })

      const runAllFiles = (files: ReadonlyArray<readonly [string, FileTree]>, index: number): Effect.Effect<void> =>
        index >= files.length
          ? Effect.void
          : Effect.flatMap(runFileAt(files, index), () => runAllFiles(files, index + 1))

      const runFileAt = (
        files: ReadonlyArray<readonly [string, FileTree]>,
        index: number,
      ): Effect.Effect<void> =>
        Option.match(Option.fromNullishOr(files[index]), {
          onNone: () => Effect.void,
          onSome: (entry) => runIndexedFile(entry[0], entry[1], index, files.length),
        })

      const runExecution = (): Effect.Effect<Record<string, TestOutcome>> =>
        Effect.gen(function*() {
          const drainingFiles = [...fileNodes].filter(([, tree]) => tree.children.length > 0)
          yield* runAllFiles(drainingFiles, 0)
          return outcomes
        })

      const executeStages = (): Effect.Effect<Record<string, TestOutcome> | undefined> => {
        const timedExecution = runExecution()
        return timeoutMs !== undefined
          ? Effect.map(Effect.timeoutOption(timedExecution, timeoutMs), Option.getOrUndefined)
          : timedExecution
      }

      const decideFor = (collected: Record<string, TestOutcome>): DrainOutcome => {
        const command = DrainRegistryCommand.make({
          plan: plan.map(plannedViewOf),
          timedOut: false,
          outcomes: collected,
          lateRejections,
        })
        const decision = pureDrainRegistry(command)
        return Result.isSuccess(decision) ? decision.success : DrainTimedOut.make({})
      }

      const timedOutOutcome = (): Effect.Effect<DrainOutcome> =>
        Effect.map(Effect.promise(() => closeOpenLayerScopes()), () => DrainTimedOut.make({}))

      const completedOutcome = (collected: Record<string, TestOutcome>): Effect.Effect<DrainOutcome> =>
        Effect.map(
          Effect.callback<void>((resume) => {
            hostImmediate(() => resume(Effect.void))
          }),
          () => decideFor(collected),
        )

      const afterCollected = (collected: Record<string, TestOutcome> | undefined): Effect.Effect<DrainOutcome> =>
        collected === undefined ? timedOutOutcome() : completedOutcome(collected)

      const collectingLateRejections = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.flatMap(
          Effect.sync(() => {
            globalThis.process.on('unhandledRejection', rejectionListener)
          }),
          () =>
            Effect.ensuring(
              effect,
              Effect.sync(() => {
                globalThis.process.off('unhandledRejection', rejectionListener)
              }),
            ),
        )

      const runDrain = (): Effect.Effect<DrainOutcome> =>
        collectingLateRejections(Effect.flatMap(executeStages(), afterCollected))

      buildRunnerTrees()
      return yield* runDrain()
    }).pipe(
      Effect.scoped,
      Effect.provideService(Scheduler, microtaskScheduler),
      Effect.runPromise,
    ),
)
