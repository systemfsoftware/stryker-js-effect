import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  activateSandbox,
  createHarnessApi,
  createRegistry,
  deactivateSandbox,
  drainRegistry,
  guardedExpect,
  guardedVi,
  installInterception,
  makeEffectMethods,
  nativeImport,
  uninstallInterception,
  writeGlobalState,
} from '@systemfsoftware/stryker-vm-harness'
import type { VmRunnerGlobalState } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as Semaphore from 'effect/Semaphore'

import { ALL_TESTS_ID, ALL_TESTS_NAME } from './command-runner.resource.js'
import { interpretDryRunResult, InterpretDryRunResultCommand } from './interpret-dry-run-result.workflow.js'
import { make as makePooledTestRunner, type PooledTestRunner } from './pooled-test-runner.handle.js'
import { VmRunner } from './VmRunner.service.js'
import type { VmPlatform } from './VmRunner.service.js'

const vmRunnerName = 'vm'

const vmRunnerCapabilities = { reloadEnvironment: true } as const satisfies TestRunner.TestRunnerCapabilities

export const isVmRunner = (name: Options.TestRunnerConfig): name is 'vm' =>
  typeof name === 'string' && name.toLowerCase() === vmRunnerName

export interface VmTestRunnerConfig {
  readonly testFiles: readonly string[]
  readonly sandboxWorkingDirectory?: string
}

const errorText = <A = unknown>(error: A): string =>
  Match.value(error).pipe(
    Match.when(Match.instanceOf(Error), (failure) => failure.message),
    Match.orElse((value) => String(value)),
  )

const isInitFailure = <A = unknown>(error: A): boolean => {
  if (error instanceof SyntaxError) {
    return true
  }
  if (typeof error !== 'object' || error === null) {
    return false
  }
  if ('code' in error && error.code === 'ERR_MODULE_NOT_FOUND') {
    return true
  }
  return error instanceof Error && error.message.includes('[PARSE_ERROR]')
}

interface RunFailure {
  readonly file: string
  readonly message: string
  readonly fatal: boolean
}

const runFailureFor = <A = unknown>(file: string, cause: A): RunFailure => {
  const fatal = isInitFailure(cause)
  const message = fatal
    ? `Could not load "${file}" for the in-memory runner: ${errorText(cause)}`
    : errorText(cause)
  return { file, message, fatal }
}

let saltCounter = 0

const isPlainObject = <A = unknown>(value: unknown): value is Record<string, A> => Predicate.isObject(value)

const descriptorValue = <A>(descriptor: TypedPropertyDescriptor<A> | undefined) =>
  Option.fromNullishOr(descriptor?.value)

const createHostNamespace = <A = unknown>(): Record<string, A> => {
  const created: Record<string, A> = {}
  Object.defineProperty(globalThis, Mutant.InstrumenterContext.NAMESPACE, {
    configurable: true,
    enumerable: true,
    value: created,
    writable: true,
  })
  return created
}

const hostStrykerNamespace = <A = unknown>(): Record<string, A> =>
  Option.match(
    descriptorValue<Record<string, A>>(
      Object.getOwnPropertyDescriptor(globalThis, Mutant.InstrumenterContext.NAMESPACE),
    ),
    {
      onNone: () => createHostNamespace<A>(),
      onSome: (current) =>
        Match.value(isPlainObject<A>(current)).pipe(
          Match.when(true, (): Record<string, A> => current),
          Match.orElse(() => createHostNamespace<A>()),
        ),
    },
  )

const monolithicResult = (failureMessage: string | undefined, timeSpentMs: number): TestRunner.CompleteDryRunResult =>
  Match.value(failureMessage).pipe(
    Match.when(Predicate.isString, (failure) => ({
      status: 'complete' as const,
      tests: [{
        id: ALL_TESTS_ID,
        name: ALL_TESTS_NAME,
        status: 'failed' as const,
        failureMessage: failure,
        timeSpentMs,
      }],
    })),
    Match.orElse(() => ({
      status: 'complete' as const,
      tests: [{ id: ALL_TESTS_ID, name: ALL_TESTS_NAME, status: 'success' as const, timeSpentMs }],
    })),
  )

const prefixOf = (file: string, pathToFileURL: (path: string) => { readonly href: string }): string => {
  const href = pathToFileURL(file).href
  const lastSlash = href.lastIndexOf('/')
  return href.slice(0, lastSlash + 1)
}

const commonPrefixOf = (
  files: readonly string[],
  pathToFileURL: (path: string) => { readonly href: string },
): string => {
  const dirs = files.map((file) => prefixOf(file, pathToFileURL))
  return Option.match(Option.fromNullishOr(dirs[0]), {
    onNone: () => '',
    onSome: (first) =>
      dirs.slice(1).reduce((prefix, dir) => shrinkPrefixTo(prefix, dir), first),
  })
}

const shrinkPrefixTo = (prefix: string, dir: string): string => {
  let current = prefix
  while (current !== '' && !dir.startsWith(current)) {
    const cut = current.lastIndexOf('/', current.length - 2)
    current = cut > 0 ? current.slice(0, cut + 1) : ''
  }
  return current
}

const serialRunGate = Semaphore.makeUnsafe(1)

const testResultOf = (test: {
  readonly file: string
  readonly fullName: string
  readonly timeSpentMs: number
  readonly status: string
  readonly failureMessage?: string | undefined
}): TestRunner.TestResult => {
  const base = { id: `${test.file}#${test.fullName}`, name: test.fullName, timeSpentMs: test.timeSpentMs }
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

const loadErrorResult = (runFailure: RunFailure): TestRunner.TestResult => ({
  id: `${runFailure.file}#load error`,
  name: `${runFailure.file} (load error)`,
  status: 'failed',
  failureMessage: runFailure.message,
  timeSpentMs: 0,
})

const runOnce = (
  platform: VmPlatform,
  testFiles: readonly string[],
  timeoutMs: number | undefined,
  activeMutantId: string | undefined,
  sandboxWorkingDirectory: string | undefined,
): Effect.Effect<TestRunner.DryRunResult, TestRunner.TestRunnerFailed> =>
  Effect.gen(function*() {
    const firstFile = Option.fromNullishOr(testFiles[0])
    if (Option.isNone(firstFile)) {
      return monolithicResult(undefined, 0)
    }
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    const namespace = hostStrykerNamespace<string | undefined>()
    const previousActive = namespace[Mutant.InstrumenterContext.ACTIVE_MUTANT]
    namespace[Mutant.InstrumenterContext.ACTIVE_MUTANT] = activeMutantId
    let armed = false
    try {
      const real = yield* Effect.tryPromise({
        try: () => import('vitest'),
        catch: (cause) =>
          TestRunner.TestRunnerFailed.make({
            runnerName: vmRunnerName,
            phase: 'init',
            cause: cause instanceof Error ? cause.message : 'the vitest module failed to load',
          }),
      })
      const state: VmRunnerGlobalState = {
        api,
        expect: guardedExpect(real.expect),
        vi: guardedVi(real.vi),
        effectVitest: {
          it: makeEffectMethods({
            api: api.it,
            describe: api.describe,
            hooks: api.hooks,
            tests: registry.tests,
          }),
        },
      }

      const prefix = Option.match(Option.fromNullishOr(sandboxWorkingDirectory), {
        onNone: () => commonPrefixOf(testFiles, platform.pathToFileURL),
        onSome: (directory) => platform.pathToFileURL(directory).href.replace(/\/?$/, '/'),
      })

      installInterception(platform.moduleBuiltin)
      activateSandbox(prefix)
      writeGlobalState(state)
      armed = true

      const salt = saltCounter++
      const loadFailure = yield* Effect.forEach(testFiles, (file) =>
        Effect.promise(() => {
          registry.files.current = file
          registry.frames.current = []
          const url = `${platform.pathToFileURL(file).href}?salt=${salt}`
          return nativeImport(url).then(
            () => Option.none<RunFailure>(),
            <A = unknown>(cause: A) => Option.some(runFailureFor(file, cause)),
          )
        }))
      const fatal = loadFailure.find((failure) => failure.fatal)
      if (fatal !== undefined) {
        return yield* TestRunner.TestRunnerFailed.make({
          runnerName: vmRunnerName,
          phase: 'init',
          cause: fatal.message,
        })
      }
      const runFailure = loadFailure[0]

      const outcome = yield* Effect.promise(() => drainRegistry(registry, timeoutMs))
      if (outcome.kind === 'timeout') {
        return { status: 'timeout' }
      }
      const drainedElapsed = outcome.tests.reduce((total, test) => total + test.timeSpentMs, 0)
      if (registry.tests.length === 0) {
        return monolithicResult(Option.map(runFailure, (failure) => failure.message).pipe(Option.getOrUndefined), drainedElapsed)
      }
      const tests: TestRunner.TestResult[] = outcome.tests.map(testResultOf)
      return {
        status: 'complete',
        tests: Option.match(runFailure, {
          onNone: () => tests,
          onSome: (failure) => [...tests, loadErrorResult(failure)],
        }),
      }
    } finally {
      if (armed) {
        writeGlobalState(undefined)
        deactivateSandbox()
        uninstallInterception()
      }
      namespace[Mutant.InstrumenterContext.ACTIVE_MUTANT] = previousActive
    }
  })

export const vmTestRunner = (
  config: VmTestRunnerConfig,
): Effect.Effect<PooledTestRunner, TestRunner.TestRunnerFailed, VmRunner> =>
  Effect.gen(function*() {
    const platform = yield* VmRunner

    const run = (testFiles: readonly string[], timeoutMs: number | undefined, activeMutantId: string | undefined) =>
      serialRunGate.withPermits(1)(
        runOnce(platform, testFiles, timeoutMs, activeMutantId, config.sandboxWorkingDirectory),
      )

    const testFilesOf = (override: readonly string[] | undefined) =>
      Match.value(config.testFiles).pipe(
        Match.when((files) => files.length > 0, (files) => files),
        Match.orElse(() => override ?? []),
      )

    return makePooledTestRunner({
      capabilities: Effect.succeed(vmRunnerCapabilities),
      init: Effect.void,
      dryRun: (options: TestRunner.DryRunOptions) => run(testFilesOf(options.testFiles), options.timeout, undefined),
      mutantRun: (options: Mutant.MutantRunOptions) =>
        run(config.testFiles, options.timeout, options.activeMutant.id).pipe(
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
  })
