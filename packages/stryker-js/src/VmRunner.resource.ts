import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { Assertions, Drain, EffectAdapter, Registry, Sandbox } from '@systemfsoftware/stryker-vm-harness'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
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
import type { VmFileUrl, VmPlatform } from './VmRunner.service.js'

const vmRunnerName = 'vm'

const vmRunnerCapabilities = { reloadEnvironment: true } as const satisfies TestRunner.TestRunnerCapabilities

export const isVmRunner = (name: Options.TestRunnerConfig): name is 'vm' =>
  typeof name === 'string' && name.toLowerCase() === vmRunnerName

export interface VmTestRunnerConfig {
  readonly testFiles: readonly string[]
  readonly sandboxWorkingDirectory?: string
}

interface DrainedTestView {
  readonly fullName: string
  readonly file: string
  readonly status: 'success' | 'failed' | 'skipped'
  readonly failureMessage?: string | undefined
  readonly timeSpentMs: number
}

interface RunFailure {
  readonly file: string
  readonly message: string
  readonly fatal: boolean
}

const errorText = <A = unknown>(error: A): string =>
  Match.value(error).pipe(
    Match.when(Match.instanceOf(Error), (failure) => failure.message),
    Match.orElse((value) => String(value)),
  )

const errorCodeOf = <A = unknown>(error: A): Option.Option<string> =>
  Option.flatMap(
    Option.filter(Option.some(error), Predicate.isObject),
    (object) => Option.map(Option.fromNullishOr(object['code']), String),
  )

const isModuleNotFound = <A = unknown>(error: A): boolean =>
  Option.exists(errorCodeOf(error), (code) => code === 'ERR_MODULE_NOT_FOUND')

const isSyntaxError = <A = unknown>(error: A): boolean => error instanceof SyntaxError

const isParseError = <A = unknown>(error: A): boolean =>
  error instanceof Error && error.message.includes('[PARSE_ERROR]')

const initFailureChecks = <A>(): readonly ((error: A) => boolean)[] => [
  isSyntaxError<A>,
  isModuleNotFound<A>,
  isParseError<A>,
]

const isInitFailure = <A = unknown>(error: A): boolean => initFailureChecks<A>().some((check) => check(error))

const runFailureFor = <A = unknown>(file: string, cause: A): RunFailure => {
  const fatal = isInitFailure(cause)
  const message = fatal ? `Could not load "${file}" for the in-memory runner: ${errorText(cause)}` : errorText(cause)
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
        Boolean.match(isPlainObject<A>(current), {
          onTrue: (): Record<string, A> => current,
          onFalse: () => createHostNamespace<A>(),
        }),
    },
  )

const setActiveMutant = (namespace: Record<string, string | undefined>, id: string | undefined): void => {
  namespace[Mutant.InstrumenterContext.ACTIVE_MUTANT] = id
}

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

const prefixOf = (file: string, pathToFileURL: (path: string) => VmFileUrl): string => {
  const href = pathToFileURL(file).href
  return href.slice(0, href.lastIndexOf('/') + 1)
}

const separatorBefore = (prefix: string): number => prefix.lastIndexOf('/', prefix.length - 2)

const shrunkPrefix = (prefix: string): string =>
  Option.match(Option.filter(Option.some(separatorBefore(prefix)), (cut) => cut > 0), {
    onNone: () => '',
    onSome: (cut) => prefix.slice(0, cut + 1),
  })

const shrinkPrefixTo = (prefix: string, directory: string): string =>
  Match.value(prefix === '' || directory.startsWith(prefix)).pipe(
    Match.when(true, () => prefix),
    Match.orElse(() => shrinkPrefixTo(shrunkPrefix(prefix), directory)),
  )

const commonPrefixOf = (files: readonly string[], pathToFileURL: (path: string) => VmFileUrl): string =>
  Option.match(Arr.head(files), {
    onNone: () => '',
    onSome: (first) =>
      files
        .slice(1)
        .reduce(
          (prefix, file) => shrinkPrefixTo(prefix, prefixOf(file, pathToFileURL)),
          prefixOf(first, pathToFileURL),
        ),
  })

const sandboxPrefixOf = (
  testFiles: readonly string[],
  platform: VmPlatform,
  sandboxWorkingDirectory: string | undefined,
): string =>
  Option.match(Option.fromNullishOr(sandboxWorkingDirectory), {
    onNone: () => commonPrefixOf(testFiles, platform.pathToFileURL),
    onSome: (directory) => platform.pathToFileURL(directory).href.replace(/\/?$/, '/'),
  })

const serialRunGate = Semaphore.makeUnsafe(1)

const testResultOf = (test: DrainedTestView): TestRunner.TestResult => {
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

const initFailureOf = (failures: readonly RunFailure[]): Option.Option<TestRunner.TestRunnerFailed> =>
  Option.map(
    Arr.findFirst(failures, (failure) => failure.fatal),
    (failure) => TestRunner.TestRunnerFailed.make({ runnerName: vmRunnerName, phase: 'init', cause: failure.message }),
  )

const loadErrorsOf = (failures: readonly RunFailure[]): readonly TestRunner.TestResult[] =>
  Option.toArray(Option.map(Arr.head(failures), loadErrorResult))

const firstMessageOf = (failures: readonly RunFailure[]): string | undefined =>
  Option.map(Arr.head(failures), (failure) => failure.message).pipe(Option.getOrUndefined)

const elapsedOf = (tests: readonly DrainedTestView[]): number =>
  tests.reduce((total, test) => total + test.timeSpentMs, 0)

const completedResult = (
  drained: Drain.DrainCompleted,
  registeredTestCount: number,
  failures: readonly RunFailure[],
): TestRunner.DryRunResult =>
  Match.value(registeredTestCount === 0).pipe(
    Match.when(true, () => monolithicResult(firstMessageOf(failures), elapsedOf(drained.tests))),
    Match.orElse((): TestRunner.DryRunResult => ({
      status: 'complete',
      tests: [...drained.tests.map(testResultOf), ...loadErrorsOf(failures)],
    })),
  )

const outcomeOf = (
  drained: Drain.DrainOutcome,
  registeredTestCount: number,
  failures: readonly RunFailure[],
): TestRunner.DryRunResult =>
  Match.value(drained).pipe(
    Match.when({ kind: 'timeout' }, (): TestRunner.DryRunResult => ({ status: 'timeout' })),
    Match.when({ kind: 'complete' }, (completed) => completedResult(completed, registeredTestCount, failures)),
    Match.exhaustive,
  )

const disarmSandbox = (): void => {
  Sandbox.writeGlobalState(undefined)
  Sandbox.deactivateSandbox()
  Sandbox.uninstallInterception()
}

const loadVitest = () =>
  Effect.tryPromise({
    try: () => import('vitest'),
    catch: (cause) =>
      TestRunner.TestRunnerFailed.make({
        runnerName: vmRunnerName,
        phase: 'init',
        cause: cause instanceof Error ? cause.message : 'the vitest module failed to load',
      }),
  })

const runOnce = (
  platform: VmPlatform,
  testFiles: readonly string[],
  timeoutMs: number | undefined,
  activeMutantId: string | undefined,
  sandboxWorkingDirectory: string | undefined,
): Effect.Effect<TestRunner.DryRunResult, TestRunner.TestRunnerFailed> => {
  const namespace = hostStrykerNamespace<string | undefined>()
  const previousActive = namespace[Mutant.InstrumenterContext.ACTIVE_MUTANT]
  return Effect.gen(function*() {
    const registry = Registry.createRegistry()
    setActiveMutant(namespace, activeMutantId)
    const real = yield* loadVitest()
    const salt = saltCounter++
    const prefix = sandboxPrefixOf(testFiles, platform, sandboxWorkingDirectory)

    const verified = yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const api = Registry.createHarnessApi(registry)
        const state: Sandbox.VmRunnerGlobalState = {
          api,
          expect: Assertions.guardedExpect(real.expect),
          vi: Assertions.guardedVi(real.vi),
          effectVitest: {
            it: EffectAdapter.makeEffectMethods({
              api: api.it,
              describe: api.describe,
              hooks: api.hooks,
              tests: registry.tests,
            }),
          },
        }
        Sandbox.installInterception(platform.moduleBuiltin)
        Sandbox.activateSandbox(prefix)
        Sandbox.writeGlobalState(state)
      }),
      () =>
        Effect.gen(function*() {
          const loaded = yield* Effect.forEach(testFiles, (file) =>
            Effect.promise(() => {
              registry.files.current = file
              registry.frames.current = []
              const url = `${platform.pathToFileURL(file).href}?salt=${salt}`
              return Sandbox.nativeImport(url).then(
                () => Option.none<RunFailure>(),
                <A = unknown>(cause: A) => Option.some(runFailureFor(file, cause)),
              )
            }))
          const failures = Arr.getSomes(loaded)
          const drained = yield* Option.match(initFailureOf(failures), {
            onSome: Effect.fail,
            onNone: () => Effect.promise(() => Drain.drainRegistry(registry, timeoutMs)),
          })
          return { drained, failures }
        }),
      () => Effect.sync(disarmSandbox),
    )
    return outcomeOf(verified.drained, registry.tests.length, verified.failures)
  }).pipe(Effect.ensuring(Effect.sync(() => setActiveMutant(namespace, previousActive))))
}

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
