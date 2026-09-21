import { INSTRUMENTER_CONSTANTS } from '@systemfsoftware/stryker-js-instrumenter'
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
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'
import * as Semaphore from 'effect/Semaphore'

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
import type { HarnessModuleBuiltin, VmRunnerGlobalState } from '@systemfsoftware/stryker-vm-harness'
import type { PooledTestRunner } from './TestRunner.js'

export interface VmFileUrl {
  readonly href: string
}

export interface VmPlatform {
  readonly moduleBuiltin: HarnessModuleBuiltin
  readonly pathToFileURL: (path: string) => VmFileUrl
}
export class VmRunner extends Context.Service<VmRunner, VmPlatform>()('@systemfsoftware/stryker-js/VmRunner') {}

export const vmRunnerName = 'vm'

export const ALL_TESTS_ID = 'all'
export const ALL_TESTS_NAME = 'All tests'

export const isVmRunner = (name: TestRunnerConfig): name is 'vm' =>
  typeof name === 'string' && name.toLowerCase() === vmRunnerName

export const vmRunnerCapabilities = { reloadEnvironment: true } as const satisfies TestRunnerCapabilities

export interface VmTestRunnerConfig {
  readonly testFiles: readonly string[]
  readonly sandboxWorkingDirectory?: string
}

const errorText = (error: unknown): string =>
  Match.value(error).pipe(
    Match.when(Match.instanceOf(Error), (failure) => failure.message),
    Match.orElse((value) => String(value)),
  )

const isInitFailure = (error: unknown): boolean => {
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

const runFailureFor = (file: string, cause: unknown): RunFailure => {
  const fatal = isInitFailure(cause)
  const message = fatal
    ? `Could not load "${file}" for the in-memory runner: ${errorText(cause)}`
    : errorText(cause)
  return { file, message, fatal }
}

let saltCounter = 0

const isPlainObject = (value: unknown): value is Record<string, unknown> => Predicate.isObject(value)

const descriptorValue = (descriptor: PropertyDescriptor | undefined): unknown => {
  if (descriptor === undefined) {
    return undefined
  }
  return descriptor.value
}

const hostStrykerNamespace = (): Record<string, unknown> => {
  const current = descriptorValue(Object.getOwnPropertyDescriptor(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE))
  if (isPlainObject(current)) {
    return current
  }
  const created: Record<string, unknown> = {}
  Object.defineProperty(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE, {
    configurable: true,
    enumerable: true,
    value: created,
    writable: true,
  })
  return created
}

const monolithicResult = (failureMessage: string | undefined, timeSpentMs: number): CompleteDryRunResult =>
  Match.value(failureMessage).pipe(
    Match.when(Match.string, (failure) => ({
      status: 'complete' as const,
      tests: [
        {
          id: ALL_TESTS_ID,
          name: ALL_TESTS_NAME,
          status: 'failed' as const,
          failureMessage: failure,
          timeSpentMs,
        },
      ],
    })),
    Match.orElse(() => ({
      status: 'complete' as const,
      tests: [{ id: ALL_TESTS_ID, name: ALL_TESTS_NAME, status: 'success' as const, timeSpentMs }],
    })),
  )

const prefixOf = (file: string, pathToFileURL: (path: string) => VmFileUrl): string => {
  const href = pathToFileURL(file).href
  const lastSlash = href.lastIndexOf('/')
  return href.slice(0, lastSlash + 1)
}

const serialRunGate = Semaphore.makeUnsafe(1)

const runOnce = (
  platform: VmPlatform,
  testFiles: readonly string[],
  timeoutMs: number | undefined,
  activeMutantId: string | undefined,
  sandboxWorkingDirectory: string | undefined,
): Effect.Effect<DryRunResult, TestRunnerFailed> =>
  Effect.gen(function*() {
    const firstFile = testFiles[0]
    if (firstFile === undefined) {
      return monolithicResult(undefined, 0)
    }
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    const real = yield* Effect.promise(() => import('vitest'))
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

    const prefix = sandboxWorkingDirectory !== undefined
      ? `${platform.pathToFileURL(sandboxWorkingDirectory).href.replace(/\/?$/, '/')}`
      : prefixOf(firstFile, platform.pathToFileURL)
    const namespace = hostStrykerNamespace()
    const previousActive = namespace[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT]
    namespace[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT] = activeMutantId

    installInterception(platform.moduleBuiltin)
    activateSandbox(state, prefix)
    writeGlobalState(state)

    let runFailure: RunFailure | undefined
    try {
      const salt = saltCounter++
      for (const file of testFiles) {
        registry.files.current = file
        registry.frames.current = []
        const url = `${platform.pathToFileURL(file).href}?salt=${salt}`
        const outcome = yield* Effect.promise(() =>
          nativeImport(url).then(
            () => undefined,
            (cause: unknown) => ({ cause }),
          )
        )
        if (outcome !== undefined) {
          const failure = runFailureFor(file, outcome.cause)
          if (failure.fatal) {
            return yield* TestRunnerFailed.make({
              runnerName: vmRunnerName,
              phase: 'init',
              cause: failure.message,
            })
          }
          runFailure ??= failure
        }
      }
      const outcome = yield* Effect.promise(() => drainRegistry(registry, timeoutMs))
      if (outcome.kind === 'timeout') {
        return { status: 'timeout' }
      }
      const drainedElapsed = outcome.tests.reduce((total, test) => total + test.timeSpentMs, 0)
      if (registry.tests.length === 0) {
        return monolithicResult(runFailure?.message, drainedElapsed)
      }
      const tests: TestResult[] = outcome.tests.map((test): TestResult => {
        const base = {
          id: `${test.file}#${test.fullName}`,
          name: test.fullName,
          timeSpentMs: test.timeSpentMs,
        }
        if (test.status === 'failed') {
          return { ...base, status: 'failed', failureMessage: test.failureMessage ?? '' }
        }
        return test.status === 'skipped' ? { ...base, status: 'skipped' } : { ...base, status: 'success' }
      })
      if (runFailure !== undefined) {
        tests.push({
          id: `${runFailure.file}#load error`,
          name: `${runFailure.file} (load error)`,
          status: 'failed',
          failureMessage: runFailure.message,
          timeSpentMs: 0,
        })
      }
      return { status: 'complete', tests }
    } finally {
      writeGlobalState(undefined)
      deactivateSandbox()
      uninstallInterception()
      namespace[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT] = previousActive
    }
  })

export const vmTestRunner = (
  config: VmTestRunnerConfig,
): Effect.Effect<PooledTestRunner, TestRunnerFailed, VmRunner> =>
  Effect.gen(function*() {
    const platform = yield* VmRunner

    const run = (testFiles: readonly string[], timeoutMs: number | undefined, activeMutantId: string | undefined) =>
      serialRunGate.withPermits(1)(
        runOnce(platform, testFiles, timeoutMs, activeMutantId, config.sandboxWorkingDirectory),
      )

    const testFilesOf = (override: readonly string[] | undefined): readonly string[] =>
      Match.value(config.testFiles).pipe(
        Match.when((files) => files.length > 0, (files) => files),
        Match.orElse(() => override ?? []),
      )

    return {
      capabilities: Effect.succeed(vmRunnerCapabilities),
      init: Effect.void,
      dryRun: (options: DryRunOptions) => run(testFilesOf(options.testFiles), options.timeout, undefined),
      mutantRun: (options: MutantRunOptions) =>
        run(config.testFiles, options.timeout, String(options.activeMutant.id)).pipe(
          Effect.map((result) => toMutantRunResult(result, true)),
          Effect.catchTag(
            'TestRunnerFailed',
            (failure): Effect.Effect<MutantRunResult> =>
              Effect.succeed(toMutantRunResult({ status: 'error', errorMessage: failure.cause }, true)),
          ),
        ),
    }
  })
