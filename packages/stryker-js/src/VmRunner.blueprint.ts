import { Blueprint } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { Session } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Scope from 'effect/Scope'

import { interpretDryRunResult, InterpretDryRunResultCommand } from './interpret-dry-run-result.workflow.js'
import { make as makePooledTestRunner, type PooledTestRunner } from './pooled-test-runner.handle.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js/VmTestRunner')
export type TypeId = typeof TypeId

export const vmRunnerName = 'vm'

export const isVmRunner = (name: Options.TestRunnerConfig): name is 'vm' =>
  typeof name === 'string' && name.toLowerCase() === vmRunnerName

export const vmRunnerCapabilities = { reloadEnvironment: true } as const satisfies TestRunner.TestRunnerCapabilities

export interface VmTestRunnerConfig {
  readonly testFiles: readonly string[]
  readonly sandboxWorkingDirectory: string
}

const HOST_TIMEOUT_SLACK_MS = 1000

const messageOf = <A = unknown>(cause: A): string =>
  cause instanceof Error ? cause.message : new Error('the vm test runner failed', { cause }).message

const testResultOf = (test: Session.VmTestResult): TestRunner.TestResult => {
  const base = { id: test.id, name: test.name, timeSpentMs: test.timeSpentMs }
  return Match.value(test.status).pipe(
    Match.when('failed', (): TestRunner.TestResult => ({
      ...base,
      status: 'failed',
      failureMessage: test.failureMessage ?? '',
    })),
    Match.when('skipped', (): TestRunner.TestResult => ({ ...base, status: 'skipped' })),
    Match.orElse((): TestRunner.TestResult => ({ ...base, status: 'success' })),
  )
}

const dryRunResultOf = (
  response: Extract<Session.VmRunResponse, { status: 'complete' }>,
): TestRunner.DryRunResult => {
  const tests = response.tests.map(testResultOf)
  return Option.match(Option.fromUndefinedOr(response.mutantCoverage), {
    onNone: (): TestRunner.DryRunResult => ({ status: 'complete', tests }),
    onSome: (mutantCoverage): TestRunner.DryRunResult => ({ status: 'complete', tests, mutantCoverage }),
  })
}

const respond = (
  response: Session.VmRunResponse,
): Effect.Effect<TestRunner.DryRunResult, TestRunner.TestRunnerFailed> =>
  Match.value(response).pipe(
    Match.discriminator('status')('init-failed', (failed) =>
      Effect.fail(
        TestRunner.TestRunnerFailed.make({ runnerName: vmRunnerName, phase: 'init', cause: failed.message }),
      )),
    Match.discriminator('status')('timeout', (): Effect.Effect<TestRunner.DryRunResult> =>
      Effect.succeed({ status: 'timeout' })),
    Match.discriminator('status')('error', (errored): Effect.Effect<TestRunner.DryRunResult> =>
      Effect.succeed({ status: 'error', errorMessage: errored.errorMessage })),
    Match.discriminator('status')('complete', (complete): Effect.Effect<TestRunner.DryRunResult> =>
      Effect.succeed(dryRunResultOf(complete))),
    Match.exhaustive,
  )

const pooledVmRunner = (config: VmTestRunnerConfig, scope: Scope.Scope): PooledTestRunner => {
  let client: Session.VmWorkerClient | undefined
  let sessionTestFiles: readonly string[] = config.testFiles

  const sessionOptions = (): Session.VmSessionOptions => ({
    sandboxWorkingDirectory: config.sandboxWorkingDirectory,
    testFiles: sessionTestFiles,
  })

  const spawnClient = Effect.try({
    try: (): Session.VmWorkerClient => {
      const spawned = Session.createVmWorkerClient(sessionOptions(), {
        onExit: () => {
          if (client === spawned) {
            client = undefined
          }
        },
      })
      return spawned
    },
    catch: (cause): TestRunner.TestRunnerFailed =>
      TestRunner.TestRunnerFailed.make({
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

  const run = (
    request: Session.VmRunRequest,
  ): Effect.Effect<TestRunner.DryRunResult, TestRunner.TestRunnerFailed> =>
    Effect.gen(function*() {
      if (client === undefined) {
        const spawned = yield* spawnClient
        yield* Scope.addFinalizer(scope, Effect.promise(() => spawned.terminate()))
        client = spawned
      }
      const current = client
      const answer = yield* Effect.tryPromise({
        try: () => current.run(request),
        catch: (cause): Session.VmRunResponse => ({ status: 'error', errorMessage: messageOf(cause) }),
      }).pipe(
        Effect.catch((failed) => Effect.succeed(failed)),
        Effect.timeoutOrElse({
          duration: request.timeoutMs + HOST_TIMEOUT_SLACK_MS,
          orElse: () => dropClient.pipe(Effect.as<Session.VmRunResponse>({ status: 'timeout' })),
        }),
      )
      return yield* respond(answer)
    }).pipe(Effect.onInterrupt(() => dropClient))

  const shouldAdoptTestFiles = (): boolean => config.testFiles.length === 0 && client === undefined

  const adoptedTestFiles = (testFiles: readonly string[] | undefined): readonly string[] => testFiles ?? []

  const testFilterFieldOf = (
    testFilter: readonly string[] | undefined,
  ): { readonly testFilter?: readonly string[] } => testFilter === undefined ? {} : { testFilter: [...testFilter] }

  const hitLimitFieldOf = (hitLimit: number | undefined): { readonly hitLimit?: number } =>
    hitLimit === undefined ? {} : { hitLimit }

  const mutantRequestOf = (options: Mutant.MutantRunOptions): Session.VmRunRequest => ({
    kind: 'mutant',
    timeoutMs: options.timeout,
    activeMutantId: String(options.activeMutant.id),
    ...testFilterFieldOf(options.testFilter),
    ...hitLimitFieldOf(options.hitLimit),
    reloadEnvironment: options.reloadEnvironment,
  })

  return makePooledTestRunner({
    capabilities: Effect.succeed(vmRunnerCapabilities),
    init: Effect.void,
    dryRun: (options: TestRunner.DryRunOptions) => {
      if (shouldAdoptTestFiles()) {
        sessionTestFiles = adoptedTestFiles(options.testFiles)
      }
      return run({ kind: 'dry', timeoutMs: options.timeout, reloadEnvironment: true })
    },
    mutantRun: (options: Mutant.MutantRunOptions) =>
      run(mutantRequestOf(options)).pipe(
        Effect.map((dryRunResult) => interpretDryRunResult(InterpretDryRunResultCommand.make({ dryRunResult }))),
        Effect.flatMap((decided) =>
          Result.match(decided, {
            onFailure: (failure) => Effect.fail(failure),
            onSuccess: (decision) => Effect.succeed(decision.asResult),
          })
        ),
        Effect.catchTag(
          'TestRunnerFailed',
          (failure): Effect.Effect<TestRunner.MutantRunResult> =>
            Effect.succeed({ status: 'error', errorMessage: failure.cause }),
        ),
      ),
  })
}

const scopedOf = (
  config: VmTestRunnerConfig,
): Effect.Effect<PooledTestRunner, TestRunner.TestRunnerFailed, Scope.Scope> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    return pooledVmRunner(config, scope)
  })

const VmRunners = Blueprint.make<VmTestRunnerConfig>()(TypeId).steps({
  steps: {},
  targets: { scoped: scopedOf },
})

export type VmTestRunnerBlueprint = Blueprint.Of<typeof VmRunners>

export const vmTestRunner = (
  config: VmTestRunnerConfig,
): Effect.Effect<PooledTestRunner, TestRunner.TestRunnerFailed, Scope.Scope> => VmRunners.of(config).scoped
