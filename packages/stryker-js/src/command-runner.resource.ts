import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Options, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import { interpretDryRunResult, InterpretDryRunResultCommand } from './interpret-dry-run-result.workflow.js'
import { make as makePooledTestRunner, type PooledTestRunner } from './pooled-test-runner.handle.js'

export const ALL_TESTS_ID = 'all'
export const ALL_TESTS_NAME = 'All tests'

export const isCommandRunner = (name: Options.TestRunnerConfig): name is 'command' =>
  typeof name === 'string' && name.toLowerCase() === 'command'

interface CommandTestRunnerConfig {
  readonly workingDir: string
  readonly options: Options.StrykerOptions
}

const commandRunnerCapabilities = { reloadEnvironment: true } as const

const resultFromExit = (exitCode: number, output: string, timeSpentMs: number): TestRunner.CompleteDryRunResult =>
  Match.value(exitCode).pipe(
    Match.when(0, () => ({
      status: 'complete' as const,
      tests: [{ id: ALL_TESTS_ID, name: ALL_TESTS_NAME, status: 'success' as const, timeSpentMs }],
    })),
    Match.orElse(() => ({
      status: 'complete' as const,
      tests: [{
        id: ALL_TESTS_ID,
        name: ALL_TESTS_NAME,
        status: 'failed' as const,
        failureMessage: output,
        timeSpentMs,
      }],
    })),
  )

const mutantActivation = (activeMutantId: Mutant.MutantRunOptions['activeMutant']['id'] | undefined) =>
  Match.value(activeMutantId).pipe(
    Match.when(Predicate.isString, (id) => ({
      env: { [Mutant.InstrumenterContext.ACTIVE_MUTANT_ENV_VARIABLE]: id },
      extendEnv: true as const,
    })),
    Match.orElse(() => undefined),
  )

const spawnResult = <E = unknown>(
  outcome: Exit.Exit<{ readonly output: string; readonly exitCode: number }, E>,
  elapsed: number,
): TestRunner.DryRunResult =>
  Match.value(outcome).pipe(
    Match.tag(
      'Failure',
      (failed): TestRunner.DryRunResult => ({ status: 'error', errorMessage: String(failed.cause) }),
    ),
    Match.tag(
      'Success',
      (exited): TestRunner.DryRunResult => resultFromExit(exited.value.exitCode, exited.value.output, elapsed),
    ),
    Match.exhaustive,
  )

const runCommand = (
  config: CommandTestRunnerConfig,
  activeMutantId: Mutant.MutantRunOptions['activeMutant']['id'] | undefined,
): Effect.Effect<TestRunner.DryRunResult, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const startedAt = yield* Clock.currentTimeMillis
    const command = ChildProcess.make(config.options.commandRunner.command, {
      shell: true,
      cwd: config.workingDir,
      ...mutantActivation(activeMutantId),
    })

    const outcome = yield* Effect.scoped(
      Effect.gen(function*() {
        const handle = yield* spawner.spawn(command)
        const output = yield* handle.all.pipe(Stream.decodeText, Stream.mkString)
        const exitCode = yield* handle.exitCode
        return { output, exitCode }
      }),
    ).pipe(Effect.exit)

    return spawnResult(outcome, (yield* Clock.currentTimeMillis) - startedAt)
  })

const commandRunnerDryRun = (
  config: CommandTestRunnerConfig,
): Effect.Effect<TestRunner.DryRunResult, never, ChildProcessSpawner.ChildProcessSpawner> =>
  runCommand(config, undefined)

const commandRunnerMutantRun = (
  config: CommandTestRunnerConfig,
  mutantPick: Pick<Mutant.MutantRunOptions, 'activeMutant'>,
): Effect.Effect<TestRunner.MutantRunResult, never, ChildProcessSpawner.ChildProcessSpawner> =>
  runCommand(config, mutantPick.activeMutant.id).pipe(
    Effect.map((dryRunResult) => interpretDryRunResult(InterpretDryRunResultCommand.make({ dryRunResult }))),
    Effect.flatMap((decided) =>
      Result.match(decided, {
        onFailure: (failure) => Effect.fail(failure),
        onSuccess: (decision) => Effect.succeed(decision.asResult),
      })
    ),
  )

export const commandRunner: {
  (
    context: { readonly sandboxWorkingDirectory: string; readonly options: Options.StrykerOptions },
    spawner: ChildProcessSpawner.ChildProcessSpawner['Service'],
  ): PooledTestRunner
  (
    spawner: ChildProcessSpawner.ChildProcessSpawner['Service'],
  ): (
    context: { readonly sandboxWorkingDirectory: string; readonly options: Options.StrykerOptions },
  ) => PooledTestRunner
} = dual(
  2,
  (
    context: { readonly sandboxWorkingDirectory: string; readonly options: Options.StrykerOptions },
    spawner: ChildProcessSpawner.ChildProcessSpawner['Service'],
  ): PooledTestRunner => {
    const config = {
      workingDir: context.sandboxWorkingDirectory,
      options: context.options,
    }
    const provided = Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)

    return makePooledTestRunner({
      capabilities: Effect.succeed(commandRunnerCapabilities),
      init: Effect.void,
      dryRun: () => commandRunnerDryRun(config).pipe(provided),
      mutantRun: (options: Mutant.MutantRunOptions) => commandRunnerMutantRun(config, options).pipe(provided),
    })
  },
)
