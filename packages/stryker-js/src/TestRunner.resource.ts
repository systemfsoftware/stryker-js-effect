import { type FileDescriptions } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantRunOptions } from '@systemfsoftware/stryker-js-instrumenter'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { isCustomTestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  type DryRunOptions,
  type DryRunResult,
  type MutantRunResult,
  type TestRunnerCapabilities,
  TestRunnerFailed,
  WALL_CLOCK_TIMEOUT_REASON,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { TestRunnerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Cause from 'effect/Cause'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'

import { commandRunner, isCommandRunner } from './command-runner.resource.js'
import type { PooledTestRunnerError } from './TestRunner.schema.js'
import { isVmRunner, vmTestRunner } from './VmRunner.resource.js'
import { VmRunner } from './VmRunner.service.js'
import type { IdGeneratorShape } from './Worker.service.js'
import { OutOfMemoryError } from './Worker.schema.js'
import type { WorkerBootError } from './WorkerLauncher.service.js'
import { WorkerLauncher } from './WorkerLauncher.service.js'
import { makeWorkerClient } from './worker-client.resource.js'

export interface ChildProcessTestRunnerParams {
  readonly options: StrykerOptions
  readonly fileDescriptions: FileDescriptions
  readonly sandboxWorkingDirectory: string
  readonly workerEntrypoint: string
  readonly idGenerator: IdGeneratorShape
}

export interface PooledTestRunner {
  readonly capabilities: Effect.Effect<TestRunnerCapabilities, PooledTestRunnerError>
  readonly init: Effect.Effect<void, PooledTestRunnerError>
  readonly dryRun: (options: DryRunOptions) => Effect.Effect<DryRunResult, PooledTestRunnerError>
  readonly mutantRun: (options: MutantRunOptions) => Effect.Effect<MutantRunResult, PooledTestRunnerError>
}

export interface TestRunnerBuildContext {
  readonly options: StrykerOptions
  readonly fileDescriptions: FileDescriptions
  readonly sandboxWorkingDirectory: string
  readonly idGenerator: IdGeneratorShape
  readonly retire: Effect.Effect<void>
  readonly testFiles: readonly string[]
}

const toRunnerBootFailure = (runnerName: string) => (error: WorkerBootError): PooledTestRunnerError =>
  Match.value(error).pipe(
    Match.tag(
      'WorkerBootTimeoutError',
      (timeout): PooledTestRunnerError =>
        TestRunnerFailed.make({
          runnerName,
          phase: 'init',
          cause:
            `Worker ${timeout.pid} did not accept the RPC connection before its boot window closed; its stderr above carries the reason`,
        }),
    ),
    Match.tag('ChildProcessCrashedError', (crashed): PooledTestRunnerError => crashed),
    Match.tag('OutOfMemoryError', (outOfMemory): PooledTestRunnerError => outOfMemory),
    Match.exhaustive,
  )

const toRunnerFailure =
  (runnerName: string, phase: 'capabilities' | 'init' | 'dryRun' | 'mutantRun' | 'dispose') =>
  (error: RpcClientError | TestRunnerFailed): PooledTestRunnerError =>
    Match.value(error).pipe(
      Match.tag('TestRunnerFailed', (e): PooledTestRunnerError => e),
      Match.orElse((e) => TestRunnerFailed.make({ runnerName, phase, cause: e.message })),
    )

/**
 * A test runner that runs in a child process.
 *
 * Spawning happens **once**, here, and the child's teardown is a finalizer on the
 * scope this Effect is acquired in — which is the scope `Pool.make` opens for one
 * worker. So a worker lives as long as its pool slot, and each `dryRun` or
 * `mutantRun` only sends a message to a process that is already up.
 *
 * The scope boundary is the whole correctness question. Putting it inside each
 * method type-checks identically and spawns a Node process per mutant, which
 * makes the pool hold nothing and pays worker startup thousands of times.
 *
 * A failed spawn stays a typed failure rather than a defect, because
 * `Pool.invalidate` and the crash-retry combinator can only act on a failure they
 * can see.
 */
export const makeChildProcessTestRunner = (
  params: ChildProcessTestRunnerParams,
): Effect.Effect<PooledTestRunner, PooledTestRunnerError, Scope.Scope | WorkerLauncher> =>
  Effect.gen(function*() {
    const runnerName = Match.value(params.options.testRunner).pipe(
      Match.when(isCustomTestRunner, (runner) => runner.plugin),
      Match.orElse((name) => name),
    )
    const execArgv = Match.value(params.options.testRunner).pipe(
      Match.when(isCustomTestRunner, (runner) =>
        Match.value(runner.nodeArgs).pipe(
          Match.when(Match.undefined, () => params.options.testRunnerNodeArgs),
          Match.orElse((args) => args),
        )),
      Match.orElse(() => params.options.testRunnerNodeArgs),
    )
    const client = yield* makeWorkerClient({
      rpcs: TestRunnerRpcs,
      options: params.options,
      entrypoint: params.workerEntrypoint,
      workingDirectory: params.sandboxWorkingDirectory,
      execArgv: [...execArgv],
      tempDirPrefix: 'stryker-test-runner-',
      env: {
        NODE_ENV: 'test',
        VITEST: '1',
        STRYKER_SANDBOX_DIR: params.sandboxWorkingDirectory,
      },
    }).pipe(Effect.mapError(toRunnerBootFailure(runnerName)))
    const runner = {
      capabilities: client.capabilities().pipe(Effect.mapError(toRunnerFailure(runnerName, 'capabilities'))),
      init: Effect.void,
      dryRun: (options: DryRunOptions) =>
        client.dryRun({ options }).pipe(Effect.mapError(toRunnerFailure(runnerName, 'dryRun'))),
      mutantRun: (options: MutantRunOptions) =>
        client.mutantRun({ options }).pipe(Effect.mapError(toRunnerFailure(runnerName, 'mutantRun'))),
    } satisfies PooledTestRunner
    return runner
  })

type RunPolicy<A, E> = (self: Effect.Effect<A, E, never>) => Effect.Effect<A, E, never>

type TestRunnerCombinator = (inner: PooledTestRunner) => PooledTestRunner

export const withTimeout: TestRunnerCombinator = (inner) => ({
  ...inner,
  dryRun: (options) =>
    inner.dryRun(options).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(options.timeout),
        orElse: (): Effect.Effect<DryRunResult> =>
          Effect.succeed({ status: 'timeout', reason: WALL_CLOCK_TIMEOUT_REASON }),
      }),
    ),
  mutantRun: (options) =>
    inner.mutantRun(options).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(options.timeout),
        orElse: (): Effect.Effect<MutantRunResult> =>
          Effect.succeed({ status: 'timeout', reason: WALL_CLOCK_TIMEOUT_REASON }),
      }),
    ),
})

export const invalidatesRunnerPool: {
  (status: string, reason: string | undefined): boolean
  (reason: string | undefined): (status: string) => boolean
} = dual(
  2,
  (status: string, reason: string | undefined): boolean => status === 'timeout' && reason === WALL_CLOCK_TIMEOUT_REASON,
)

const maxRetries = 2

const exhaustedMessage = (cause: Cause.Cause<PooledTestRunnerError>) =>
  `Test runner crashed. Tried ${maxRetries} times to restart it without any luck. ${Cause.pretty(cause)}`

export const withRetry: TestRunnerCombinator = (inner) => {
  const attempt = <A>(
    run: Effect.Effect<A, PooledTestRunnerError>,
    onExhausted: (message: string) => A,
  ): Effect.Effect<A> =>
    run.pipe(
      Effect.tapError((error) =>
        Match.value(error).pipe(
          Match.when(S.is(OutOfMemoryError), (outOfMemory) =>
            Effect.logInfo(
              `Test runner process [${outOfMemory.pid}] ran out of memory. That usually means the tests leak memory. Stryker restarts the process and carries on, but the run is slower for it.`,
            )),
          Match.orElse(() => Effect.void),
        )
      ),
      Effect.retry({ times: maxRetries }),
      Effect.catchCause((cause) => Effect.succeed(onExhausted(exhaustedMessage(cause)))),
    )
  return {
    ...inner,
    dryRun: (options) =>
      attempt(inner.dryRun(options), (errorMessage) => ({
        status: 'error',
        errorMessage,
      })),
    mutantRun: (options) =>
      attempt(inner.mutantRun(options), (errorMessage) => ({
        status: 'error',
        errorMessage,
      })),
  }
}

export const withMaxReuse: {
  (options: Pick<StrykerOptions, 'maxTestRunnerReuse'>, retire: Effect.Effect<void>): (
    inner: PooledTestRunner,
  ) => Effect.Effect<PooledTestRunner>
  (retire: Effect.Effect<void>): (
    options: Pick<StrykerOptions, 'maxTestRunnerReuse'>,
  ) => (inner: PooledTestRunner) => Effect.Effect<PooledTestRunner>
} = dual(
  2,
  (
    options: Pick<StrykerOptions, 'maxTestRunnerReuse'>,
    retire: Effect.Effect<void>,
  ): (inner: PooledTestRunner) => Effect.Effect<PooledTestRunner> =>
  (inner) =>
    Match.value(options.maxTestRunnerReuse).pipe(
      Match.when((restartAfter) => restartAfter <= 0, () => Effect.succeed(inner)),
      Match.orElse((restartAfter) =>
        Effect.gen(function*() {
          const runs = yield* Ref.make(0)

          return {
            ...inner,
            mutantRun: (runOptions: MutantRunOptions) => {
              const policy: RunPolicy<MutantRunResult, PooledTestRunnerError> = (self) =>
                Effect.gen(function*() {
                  const count = yield* Ref.updateAndGet(runs, (n) => n + 1)
                  yield* Boolean.match(count > restartAfter, {
                    onTrue: () => Effect.andThen(retire, Ref.set(runs, 1)),
                    onFalse: () => Effect.void,
                  })
                  return yield* self
                })
              return policy(inner.mutantRun(runOptions))
            },
          }
        })),
    ),
)

type EnvironmentState = 'pristine' | 'loaded' | 'loaded-static-mutant'

const nextEnvironmentState = (requested: boolean): EnvironmentState =>
  Boolean.match(requested, {
    onTrue: (): EnvironmentState => 'loaded-static-mutant',
    onFalse: (): EnvironmentState => 'loaded',
  })

const reloadEnvironmentDecision = (
  requested: MutantRunOptions['reloadEnvironment'],
  current: EnvironmentState,
  canReload: boolean,
) => canReload && stateNeedsReload(requested, current)

const stateNeedsReload = (requested: boolean, current: EnvironmentState): boolean =>
  Match.value(requested).pipe(
    Match.when(true, () => current !== 'pristine'),
    Match.orElse(() => current === 'loaded-static-mutant'),
  )

const retireDecision = (current: EnvironmentState, canReload: boolean) =>
  !canReload && current === 'loaded-static-mutant'

const reloadPlanOf = (
  requested: MutantRunOptions['reloadEnvironment'],
  current: EnvironmentState,
  canReload: boolean,
) => ({
  reloadEnvironment: reloadEnvironmentDecision(requested, current, canReload),
  retire: retireDecision(current, canReload),
  nextState: nextEnvironmentState(requested),
})

/**
 * Decide whether the test environment must be reloaded before a mutant runs.
 *
 * The decision produces a new options value; the caller's options are not
 * mutated, so a caller that reuses its own options does not read a value it
 * never wrote.
 */
export const withEnvironmentReload: {
  (retire: Effect.Effect<void>): (inner: PooledTestRunner) => Effect.Effect<PooledTestRunner>
  (inner: PooledTestRunner): (retire: Effect.Effect<void>) => Effect.Effect<PooledTestRunner>
} = dual(
  2,
  (retire: Effect.Effect<void>, inner: PooledTestRunner): Effect.Effect<PooledTestRunner> =>
    Effect.gen(function*() {
      const state = yield* Ref.make<EnvironmentState>('pristine')

      return {
        ...inner,

        dryRun: (options) => {
          const policy: RunPolicy<DryRunResult, PooledTestRunnerError> = (self) =>
            Ref.set(state, 'loaded').pipe(Effect.andThen(self))
          return policy(inner.dryRun(options))
        },

        mutantRun: (options) =>
          Effect.gen(function*() {
            const current = yield* Ref.get(state)
            const canReload = (yield* inner.capabilities).reloadEnvironment
            const plan = reloadPlanOf(options.reloadEnvironment, current, canReload)

            yield* Boolean.match(plan.retire, {
              onTrue: () => retire,
              onFalse: () => Effect.void,
            })
            const policy: RunPolicy<MutantRunResult, PooledTestRunnerError> = (self) =>
              Effect.gen(function*() {
                const result = yield* self
                yield* Ref.set(state, plan.nextState)
                return result
              })

            return yield* policy(inner.mutantRun({ ...options, reloadEnvironment: plan.reloadEnvironment }))
          }),
      }
    }),
)

const commandRunnerEffect = (
  context: TestRunnerBuildContext,
): Effect.Effect<PooledTestRunner, PooledTestRunnerError, ChildProcessSpawner.ChildProcessSpawner> =>
  ChildProcessSpawner.ChildProcessSpawner.pipe(
    Effect.map((spawner) => withRetry(withTimeout(commandRunner(context, spawner)))),
  )

const inProcessRunner = (
  context: TestRunnerBuildContext,
): Option.Option<
  Effect.Effect<PooledTestRunner, PooledTestRunnerError, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | VmRunner>
> =>
  Match.value(context.options.testRunner).pipe(
    Match.when(isCommandRunner, () => Option.some(commandRunnerEffect(context))),
    Match.when(
      isVmRunner,
      (): Option.Option<
        Effect.Effect<PooledTestRunner, PooledTestRunnerError, FileSystem.FileSystem | VmRunner>
      > => Option.some(vmTestRunner({ testFiles: context.testFiles })),
    ),
    Match.orElse(() => Option.none()),
  )

export const buildTestRunner: {
  <ChildRunnerError>(
    context: TestRunnerBuildContext,
    childProcessRunner: Effect.Effect<
      PooledTestRunner,
      ChildRunnerError,
      Scope.Scope | WorkerLauncher
    >,
  ): Effect.Effect<
    PooledTestRunner,
    PooledTestRunnerError | ChildRunnerError,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Scope.Scope | VmRunner | WorkerLauncher
  >
  <ChildRunnerError>(
    childProcessRunner: Effect.Effect<
      PooledTestRunner,
      ChildRunnerError,
      Scope.Scope | WorkerLauncher
    >,
  ): (
    context: TestRunnerBuildContext,
  ) => Effect.Effect<
    PooledTestRunner,
    PooledTestRunnerError | ChildRunnerError,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Scope.Scope | VmRunner | WorkerLauncher
  >
} = dual(
  2,
  <ChildRunnerError>(
    context: TestRunnerBuildContext,
    childProcessRunner: Effect.Effect<
      PooledTestRunner,
      ChildRunnerError,
      Scope.Scope | WorkerLauncher
    >,
  ): Effect.Effect<
    PooledTestRunner,
    PooledTestRunnerError | ChildRunnerError,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Scope.Scope | VmRunner | WorkerLauncher
  > =>
    Option.match(inProcessRunner(context), {
      onSome: (inProcess: Effect.Effect<PooledTestRunner, PooledTestRunnerError, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | VmRunner>) =>
        inProcess,
      onNone: (): Effect.Effect<
        PooledTestRunner,
        PooledTestRunnerError | ChildRunnerError,
        ChildProcessSpawner.ChildProcessSpawner | Scope.Scope | WorkerLauncher
      > =>
        Effect.gen(function*() {
          const base: PooledTestRunner = yield* childProcessRunner
          const timed = withTimeout(base)
          const limited = yield* withMaxReuse(context.options, context.retire)(timed)
          const reloading = yield* withEnvironmentReload(context.retire)(limited)
          return withRetry(reloading)
        }),
    }),
)