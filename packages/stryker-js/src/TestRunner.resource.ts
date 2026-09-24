import { type FileDescriptions } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantRunOptions } from '@systemfsoftware/stryker-js-instrumenter'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  isCustomTestRunner,
  type DryRunOptions,
  type DryRunResult,
  type MutantRunResult,
  type TestRunnerCapabilities,
  TestRunnerFailed,
  WallClockTimeoutReason,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'

import { commandRunner, isCommandRunner } from './command-runner.resource.js'
import {
  make as makePooledTestRunner,
  type PooledTestRunner,
  withEnvironmentReload,
  withMaxReuse,
  withRetry,
  withTimeout,
} from './pooled-test-runner.handle.js'
import type { PooledTestRunnerError } from './TestRunner.schema.js'
import { isVmRunner, vmTestRunner } from './VmRunner.resource.js'
import { VmRunner } from './VmRunner.service.js'
import type { IdGeneratorShape } from './Worker.service.js'
import type { WorkerBootError } from './Worker.schema.js'
import { WorkerLauncher } from './WorkerLauncher.service.js'
import { makeWorkerClient } from './worker-client.resource.js'

export interface ChildProcessTestRunnerParams {
  readonly options: StrykerOptions
  readonly fileDescriptions: FileDescriptions
  readonly sandboxWorkingDirectory: string
  readonly workerEntrypoint: string
  readonly idGenerator: IdGeneratorShape
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
    return makePooledTestRunner({
      capabilities: client.capabilities().pipe(Effect.mapError(toRunnerFailure(runnerName, 'capabilities'))),
      init: Effect.void,
      dryRun: (options: DryRunOptions) =>
        client.dryRun({ options }).pipe(Effect.mapError(toRunnerFailure(runnerName, 'dryRun'))),
      mutantRun: (options: MutantRunOptions) =>
        client.mutantRun({ options }).pipe(Effect.mapError(toRunnerFailure(runnerName, 'mutantRun'))),
    })
  })


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