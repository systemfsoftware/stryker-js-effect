import { INSTRUMENTER_CONSTANTS } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantRunOptions } from '@systemfsoftware/stryker-js-instrumenter'
import {
  type CompleteDryRunResult,
  type DryRunOptions,
  type DryRunResult,
  type MutantRunResult,
  type TestRunnerCapabilities,
  type TestRunnerConfig,
  TestRunnerFailed,
  toMutantRunResult,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'

import type { PooledTestRunner } from './TestRunner.js'

export interface VmScript {
  readonly runInContext: (context: object) => unknown
}

export type VmRequire = (specifier: string) => unknown

export interface VmModule {
  readonly createContext: (sandbox: object) => object
  readonly Script: new(code: string, options?: { readonly filename?: string }) => VmScript
}

export interface VmModuleBuiltin {
  readonly createRequire: (fileName: string | URL) => VmRequire
  readonly stripTypeScriptTypes: (
    source: string,
    options?: { readonly mode?: 'strip' | 'transform' },
  ) => string
}

export interface VmPlatform {
  readonly module: VmModuleBuiltin
  readonly vm: VmModule
}

export class VmRunner extends Context.Service<VmRunner, VmPlatform>()('@systemfsoftware/stryker-js/VmRunner') {}

export const vmRunnerName = 'vm'

export const ALL_TESTS_ID = 'all'
export const ALL_TESTS_NAME = 'All tests'

export const isVmRunner = (name: TestRunnerConfig): name is 'vm' =>
  typeof name === 'string' && name.toLowerCase() === vmRunnerName

export const vmRunnerCapabilities = { reloadEnvironment: true } as const satisfies TestRunnerCapabilities

const FALLBACK_FILE_NAME = 'stryker-vm-tests.js'

export interface VmTestRunnerConfig {
  readonly testFiles: readonly string[]
}

export interface CompiledTests {
  readonly fileName: string
  readonly script: VmScript
}

const errorText = (error: unknown): string =>
  Match.value(error).pipe(
    Match.when(Match.instanceOf(Error), (failure) => failure.message),
    Match.orElse((value) => String(value)),
  )

const compileFailure = (file: string, cause: unknown): TestRunnerFailed =>
  TestRunnerFailed.make({
    runnerName: vmRunnerName,
    phase: 'init',
    cause: `Could not compile "${file}" for the in-memory runner: ${errorText(cause)}`,
  })

const compileTests = (
  platform: VmPlatform,
  fs: FileSystem.FileSystem,
  testFiles: readonly string[],
): Effect.Effect<CompiledTests, TestRunnerFailed> =>
  Effect.gen(function*() {
    const sources = yield* Effect.forEach(testFiles, (file) =>
      fs.readFileString(file).pipe(
        Effect.mapError((cause) => compileFailure(file, cause)),
        Effect.flatMap((source) =>
          Effect.try({
            try: (): string => platform.module.stripTypeScriptTypes(source, { mode: 'transform' }),
            catch: (cause) => compileFailure(file, cause),
          })
        ),
      ))
    const fileName = Option.getOrElse(Option.fromUndefinedOr(testFiles.at(0)), () => FALLBACK_FILE_NAME)
    const script = yield* Effect.try({
      try: (): VmScript => new platform.vm.Script(sources.join('\n;\n'), { filename: fileName }),
      catch: (cause) => compileFailure(fileName, cause),
    })
    return { fileName, script }
  })

const sandboxFor = (
  platform: VmPlatform,
  fileName: string,
  activeMutantId: string | undefined,
): Record<string, unknown> => {
  const namespace: Record<string, unknown> = Match.value(activeMutantId).pipe(
    Match.when(Match.string, (active) => ({ [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT]: active })),
    Match.orElse(() => ({})),
  )
  const moduleExports: Record<string, unknown> = {}
  const moduleObj = { exports: moduleExports }
  const sandbox: Record<string, unknown> = {
    ...globalThis,
    [INSTRUMENTER_CONSTANTS.NAMESPACE]: namespace,
    require: platform.module.createRequire(fileName),
    module: moduleObj,
    exports: moduleExports,
    __filename: fileName,
  }
  sandbox['global'] = sandbox
  sandbox['globalThis'] = sandbox
  return sandbox
}

const resultFromRun = (failureMessage: string | undefined, timeSpentMs: number): CompleteDryRunResult =>
  Match.value(failureMessage).pipe(
    Match.when(Match.string, (failure) => ({
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

const runInFreshContext = (
  platform: VmPlatform,
  compiled: CompiledTests,
  activeMutantId: string | undefined,
): Effect.Effect<string | undefined> =>
  Effect.sync(() => {
    const context = platform.vm.createContext(sandboxFor(platform, compiled.fileName, activeMutantId))
    try {
      compiled.script.runInContext(context)
      return undefined
    } catch (cause) {
      return errorText(cause)
    }
  })

const runOnce = (
  platform: VmPlatform,
  compiled: CompiledTests,
  activeMutantId: string | undefined,
): Effect.Effect<DryRunResult> =>
  Effect.gen(function*() {
    const startedAt = yield* Clock.currentTimeMillis
    const failure = yield* runInFreshContext(platform, compiled, activeMutantId)
    const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt
    return resultFromRun(failure, elapsedMs)
  })

export const vmTestRunner = (
  config: VmTestRunnerConfig,
): Effect.Effect<PooledTestRunner, TestRunnerFailed, FileSystem.FileSystem | VmRunner> =>
  Effect.gen(function*() {
    const platform = yield* VmRunner
    const fs = yield* FileSystem.FileSystem
    const compiled = yield* Ref.make<Option.Option<CompiledTests>>(Option.none())

    const compiledTests = (testFiles: readonly string[]): Effect.Effect<CompiledTests, TestRunnerFailed> =>
      Effect.gen(function*() {
        const cached = yield* Ref.get(compiled)
        if (Option.isSome(cached)) {
          return cached.value
        }
        const tests = yield* compileTests(platform, fs, testFiles)
        yield* Ref.set(compiled, Option.some(tests))
        return tests
      })

    const run = (
      testFiles: readonly string[],
      activeMutantId: string | undefined,
    ): Effect.Effect<DryRunResult, TestRunnerFailed> =>
      compiledTests(testFiles).pipe(
        Effect.flatMap((tests) => runOnce(platform, tests, activeMutantId)),
      )

    const testFilesOf = (override: readonly string[] | undefined): readonly string[] =>
      Match.value(config.testFiles).pipe(
        Match.when((files) => files.length > 0, (files) => files),
        Match.orElse(() => override ?? []),
      )

    return {
      capabilities: Effect.succeed(vmRunnerCapabilities),
      init: Effect.void,
      dryRun: (options: DryRunOptions) => run(testFilesOf(options.testFiles), undefined),
      mutantRun: (options: MutantRunOptions) =>
        run(config.testFiles, options.activeMutant.id).pipe(
          Effect.map((result) => toMutantRunResult(result, true)),
          Effect.catchTag(
            'TestRunnerFailed',
            (failure): Effect.Effect<MutantRunResult> =>
              Effect.succeed(toMutantRunResult({ status: 'error', errorMessage: failure.cause }, true)),
          ),
        ),
    }
  })
