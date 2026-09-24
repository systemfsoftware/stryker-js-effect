import type { MutantRunOptions } from '@systemfsoftware/stryker-js-instrumenter'
import {
  type CompleteDryRunResult,
  type DryRunOptions,
  type DryRunResult,
  type MutantRunResult,
  type TestResult,
  type TestRunnerCapabilities,
  type TestRunnerConfig,
  TestRunnerFailed,
  toMutantRunResult,
} from '@systemfsoftware/stryker-js-plugin-interface'
import {
  createVmWorkerClient,
  type VmRunRequest,
  type VmRunResponse,
  type VmSessionOptions,
  type VmWorkerClient,
} from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'

import type { PooledTestRunner } from './TestRunner.js'

export const vmRunnerName = 'vm'

export const isVmRunner = (name: TestRunnerConfig): name is 'vm' =>
  typeof name === 'string' && name.toLowerCase() === vmRunnerName

export const vmRunnerCapabilities = { reloadEnvironment: true } as const satisfies TestRunnerCapabilities

export interface VmTestRunnerConfig {
  readonly testFiles: readonly string[]
  readonly sandboxWorkingDirectory: string
}

const messageOf = <A = unknown>(cause: A): string =>
  cause instanceof Error ? cause.message : new Error('the vm test runner failed', { cause }).message

const HOST_TIMEOUT_SLACK_MS = 1000

const dryRunResultOf = (response: Extract<VmRunResponse, { status: 'complete' }>): DryRunResult => {
  const tests: TestResult[] = response.tests.map((test): TestResult => {
    const shared = {
      id: test.id,
      name: test.name,
      timeSpentMs: test.timeSpentMs,
    }
    if (test.status === 'failed') {
      return { ...shared, status: 'failed', failureMessage: test.failureMessage ?? '' }
    }
    return test.status === 'skipped' ? { ...shared, status: 'skipped' } : { ...shared, status: 'success' }
  })
  const complete: CompleteDryRunResult = response.mutantCoverage === undefined
    ? { status: 'complete', tests }
    : { status: 'complete', tests, mutantCoverage: response.mutantCoverage }
  return complete
}

const respond = (response: VmRunResponse): Effect.Effect<DryRunResult, TestRunnerFailed> => {
  if (response.status === 'init-failed') {
    return Effect.fail(
      TestRunnerFailed.make({ runnerName: vmRunnerName, phase: 'init', cause: response.message }),
    )
  }
  if (response.status === 'timeout') {
    return Effect.succeed({ status: 'timeout' })
  }
  if (response.status === 'error') {
    return Effect.succeed({ status: 'error', errorMessage: response.errorMessage })
  }
  return Effect.succeed(dryRunResultOf(response))
}

export const vmTestRunner = (config: VmTestRunnerConfig): Effect.Effect<PooledTestRunner, TestRunnerFailed> =>
  Effect.succeed(pooledVmRunner(config))

const pooledVmRunner = (config: VmTestRunnerConfig): PooledTestRunner => {
  let client: VmWorkerClient | undefined
  let sessionTestFiles: readonly string[] = config.testFiles

  const sessionOptions = (): VmSessionOptions => ({
    sandboxWorkingDirectory: config.sandboxWorkingDirectory,
    testFiles: sessionTestFiles,
  })

  const spawnClient = Effect.try({
    try: () => {
      const spawned = createVmWorkerClient(sessionOptions(), {
        onExit: () => {
          if (client === spawned) {
            client = undefined
          }
        },
      })
      return spawned
    },
    catch: (cause): TestRunnerFailed =>
      TestRunnerFailed.make({
        runnerName: vmRunnerName,
        phase: 'init',
        cause: `the vm test runner could not start its worker: ${messageOf(cause)}`,
      }),
  })

  const dropClient: Effect.Effect<void> = Effect.suspend(() => {
    const current = client
    client = undefined
    return current === undefined ? Effect.void : Effect.promise(() => current.terminate())
  })

  const run = (request: VmRunRequest): Effect.Effect<DryRunResult, TestRunnerFailed> =>
    Effect.gen(function*() {
      if (client === undefined) {
        client = yield* spawnClient
      }
      const current = client
      const answer = yield* Effect.tryPromise({
        try: () => current.run(request),
        catch: (cause): VmRunResponse => ({ status: 'error', errorMessage: messageOf(cause) }),
      }).pipe(
        Effect.catch((failed) => Effect.succeed(failed)),
        Effect.timeoutOrElse({
          duration: request.timeoutMs + HOST_TIMEOUT_SLACK_MS,
          orElse: () => dropClient.pipe(Effect.as<VmRunResponse>({ status: 'timeout' })),
        }),
      )
      return yield* respond(answer)
    }).pipe(Effect.onInterrupt(() => dropClient))

  return {
    capabilities: Effect.succeed(vmRunnerCapabilities),
    init: Effect.void,
    dryRun: (options: DryRunOptions) => {
      if (config.testFiles.length === 0 && client === undefined) {
        sessionTestFiles = options.testFiles ?? []
      }
      return run({
        kind: 'dry',
        timeoutMs: options.timeout,
        reloadEnvironment: true,
      })
    },
    mutantRun: (options: MutantRunOptions) =>
      run({
        kind: 'mutant',
        timeoutMs: options.timeout,
        activeMutantId: String(options.activeMutant.id),
        ...(options.testFilter !== undefined ? { testFilter: [...options.testFilter] } : {}),
        ...(options.hitLimit !== undefined ? { hitLimit: options.hitLimit } : {}),
        reloadEnvironment: options.reloadEnvironment,
      }).pipe(
        Effect.map((result) => toMutantRunResult(result, true)),
        Effect.catchTag(
          'TestRunnerFailed',
          (failure): Effect.Effect<MutantRunResult> =>
            Effect.succeed(toMutantRunResult({ status: 'error', errorMessage: failure.cause }, true)),
        ),
      ),
  }
}
