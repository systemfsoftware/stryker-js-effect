import { INSTRUMENTER_CONSTANTS } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantRunOptions } from '@systemfsoftware/stryker-js-instrumenter'
import {
  type CompleteDryRunResult,
  type DryRunOptions,
  type MutantRunResult,
  MutantRunResultSchema,
  type TestRunnerCapabilities,
  type TestRunnerConfig,
  TestRunnerFailed,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Ref from 'effect/Ref'
import { SchemaGetter } from 'effect'

import { ALL_TESTS_ID, ALL_TESTS_NAME } from './command-runner.resource.js'
import { make as makePooledTestRunner, type PooledTestRunner } from './pooled-test-runner.handle.js'
import { VmRunner } from './VmRunner.service.js'
import type { VmPlatform, VmScript } from './VmRunner.service.js'

const vmRunnerName = 'vm'

const vmRunnerCapabilities = { reloadEnvironment: true } as const satisfies TestRunnerCapabilities

export const isVmRunner = (name: TestRunnerConfig): name is 'vm' =>
  typeof name === 'string' && name.toLowerCase() === vmRunnerName

export interface VmTestRunnerConfig {
  readonly testFiles: readonly string[]
}

export interface CompiledTests {
  readonly fileName: string
  readonly script: VmScript
}

const FALLBACK_FILE_NAME = 'stryker-vm-tests.js'

const errorText = <A = unknown>(error: A): string =>
  Match.value(error).pipe(
    Match.when(Match.instanceOf(Error), (failure) => failure.message),
    Match.orElse((value) => String(value)),
  )

const compileFailure = <A = unknown>(file: string, cause: A): TestRunnerFailed =>
  TestRunnerFailed.make({
    runnerName: vmRunnerName,
    phase: 'init',
    cause: `Could not compile "${file}" for the in-memory runner: ${errorText(cause)}`,
  })

const compileTests = (platform: VmPlatform, fs: FileSystem.FileSystem, testFiles: readonly string[]) =>
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
): object => {
  const namespace = hostStrykerNamespace<string | undefined>()
  namespace[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT] = activeMutantId
  const moduleExports = {}
  const moduleObj = { exports: moduleExports }
  const sandbox = {
    ...globalThis,
    [INSTRUMENTER_CONSTANTS.NAMESPACE]: namespace,
    require: platform.module.createRequire(fileName),
    module: moduleObj,
    exports: moduleExports,
    __filename: fileName,
  }
  return Object.assign(sandbox, {
    global: sandbox,
    globalThis: sandbox,
  })
}

const resultFromRun = (failureMessage: string | undefined, timeSpentMs: number): CompleteDryRunResult =>
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

const isPlainObject = <A = unknown>(value: unknown): value is Record<string, A> => Predicate.isObject(value)

const descriptorValue = <A>(descriptor: TypedPropertyDescriptor<A> | undefined) => Option.fromNullishOr(descriptor?.value)

const createHostNamespace = <A = unknown>(): Record<string, A> => {
  const created: Record<string, A> = {}
  Object.defineProperty(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE, {
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
      Object.getOwnPropertyDescriptor(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE),
    ),
    {
      onNone: () => createHostNamespace<A>(),
      onSome: (current) =>
        Boolean.match(isPlainObject<A>(current), {
          onTrue: (): Record<string, A> => current,
          onFalse: () => createHostNamespace<A>(),
        }),
    },
  )

const setActiveMutant = (activeMutantId: string | undefined) => {
  hostStrykerNamespace<string | undefined>()[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT] = activeMutantId
}

const withActiveMutant = <A, E, R>(activeMutantId: string | undefined, run: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const namespace = hostStrykerNamespace<string | undefined>()
      const previous = namespace[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT]
      namespace[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT] = activeMutantId
      return previous
    }),
    () => run,
    (previous) => Effect.sync(() => setActiveMutant(previous)),
  )

const runScriptIn = (context: object, compiled: CompiledTests): Effect.Effect<string | undefined> =>
  Effect.match(
    Effect.try({
      try: (): undefined => {
        compiled.script.runInContext(context)
        return undefined
      },
      catch: (cause) => errorText(cause),
    }),
    {
      onFailure: (message) => message,
      onSuccess: () => undefined,
    },
  )

const runInFreshContext = (platform: VmPlatform, compiled: CompiledTests, activeMutantId: string | undefined) =>
  Effect.acquireUseRelease(
    Effect.sync(() => platform.vm.createContext(sandboxFor(platform, compiled.fileName, activeMutantId))),
    (context) => withActiveMutant(activeMutantId, runScriptIn(context, compiled)),
    () => Effect.void,
  )

const elapsedSince = (startedAt: number) => Effect.map(Clock.currentTimeMillis, (now) => now - startedAt)

const runOnce = (platform: VmPlatform, compiled: CompiledTests, activeMutantId: string | undefined) =>
  Effect.flatMap(Clock.currentTimeMillis, (startedAt) =>
    Effect.flatMap(runInFreshContext(platform, compiled, activeMutantId), (failure) =>
      Effect.map(elapsedSince(startedAt), (elapsedMs) => resultFromRun(failure, elapsedMs))))

export const vmTestRunner = (
  config: VmTestRunnerConfig,
): Effect.Effect<PooledTestRunner, TestRunnerFailed, FileSystem.FileSystem | VmRunner> =>
  Effect.gen(function*() {
    const platform = yield* VmRunner
    const fs = yield* FileSystem.FileSystem
    const compiled = yield* Ref.make<Option.Option<CompiledTests>>(Option.none())

    const compiledTests = (testFiles: readonly string[]) =>
      Effect.flatMap(Ref.get(compiled), Option.match({
        onNone: () => Effect.tap(compileTests(platform, fs, testFiles), (tests) => Ref.set(compiled, Option.some(tests))),
        onSome: Effect.succeed,
      }))

    const run = (testFiles: readonly string[], activeMutantId: string | undefined) =>
      Effect.flatMap(compiledTests(testFiles), (tests) => runOnce(platform, tests, activeMutantId))

    const testFilesOf = (override: readonly string[] | undefined) =>
      Match.value(config.testFiles).pipe(
        Match.when((files) => files.length > 0, (files) => files),
        Match.orElse(() => override ?? []),
      )

    return makePooledTestRunner({
      capabilities: Effect.succeed(vmRunnerCapabilities),
      init: Effect.void,
      dryRun: (options: DryRunOptions) => run(testFilesOf(options.testFiles), undefined),
      mutantRun: (options: MutantRunOptions) =>
        run(config.testFiles, options.activeMutant.id).pipe(
          Effect.map((result) =>
            SchemaGetter.run(MutantRunResultSchema.decode({ reportAllKillers: true }), Option.some(result), {})
          ),
          Effect.map((decoded) => Option.getOrThrow(decoded)),
          Effect.catchTag('TestRunnerFailed', (failure): Effect.Effect<MutantRunResult> =>
            Effect.succeed(
              Option.getOrThrow(
                SchemaGetter.run(
                  MutantRunResultSchema.decode({ reportAllKillers: true }),
                  Option.some({ status: 'error', errorMessage: failure.cause }),
                  {},
                ),
              ),
            )),
        ),
    })
  })