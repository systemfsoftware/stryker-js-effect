import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Options, type Plugin, Reporter, type TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as EffectDuration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import { RunEvents } from '../run-events.service.js'

import { DryRunCommand, DryRunFailed, FailedTestSummary } from '../dry-run.workflow.js'
import type { LoadedPlugins } from '../Plugins.schema.js'
import { PluginNotFoundError } from '../PluginsError.schema.js'
import { offerReporterEvent, withPhaseSpan } from '../reporter-stream.service.js'
import { StageError } from '../Run.schema.js'
import { originalFileFor, sandboxFileFor, type SandboxHandle } from '../Sandbox.handle.js'
import { buildTestRunner, makeChildProcessTestRunner } from '../TestRunner.blueprint.js'
import { testRunnerConfigOf } from '../vm-runner.js'
import { IdGenerator } from '../Worker.service.js'
import type { DryRunDone, DryRunRaw } from './dry-run.cell.js'
import type { InstrumentDone } from './instrument.cell.js'
import {
  ConfiguredPluginModulePath,
  ConfiguredPluginName,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
  type WorkerSpawnResolved,
} from './resolve-configured-plugin.workflow.js'
import { phaseEntered, RunEnvironment } from './RunEnvironment.service.js'

const sandboxPathsOf = (sandbox: SandboxHandle, fileNames: readonly string[]) =>
  Result.all(fileNames.map((fileName) => sandboxFileFor(sandbox, fileName)))

const configuredPluginOf = (configured: string | { readonly plugin: string }) =>
  Match.value(testRunnerConfigOf(configured)).pipe(
    Match.when(Options.isCustomTestRunner, (custom) => ConfiguredPluginModulePath.make({ modulePath: custom.plugin })),
    Match.orElse((name) => ConfiguredPluginName.make({ name })),
  )

const workerSpawnOf = (
  stage: StageError['stage'],
  loaded: Pick<LoadedPlugins, 'pluginSources'>,
  kind: Plugin.WorkerPluginKind,
  configured: ConfiguredPluginName | ConfiguredPluginModulePath,
): Effect.Effect<WorkerSpawnResolved, StageError> =>
  Effect.mapError(
    Effect.fromResult(
      resolveConfiguredPlugin(WorkerSpawnCommand.make({ sources: loaded.pluginSources, kind, configured })),
    ),
    (missing) =>
      StageError.make({
        stage,
        reason: missing.reason,
        cause: PluginNotFoundError.make({ descriptor: missing.descriptor }),
      }),
  )

const optionalSandboxPathsOf = (command: InstrumentDone) =>
  Boolean.match(command.options.testFiles.length === 0, {
    onTrue: () => Result.succeed(undefined),
    onFalse: () => sandboxPathsOf(command.sandbox, command.project.testFiles),
  })

const buildDryRunFiles = (command: InstrumentDone) =>
  Result.flatMap(
    sandboxPathsOf(command.sandbox, [...MutableHashMap.keys(command.project.filesToMutate)]),
    (files) => Result.map(optionalSandboxPathsOf(command), (testFiles) => ({ files, testFiles })),
  )

const resolveDryRunFiles = (command: InstrumentDone) =>
  Effect.fromResult(buildDryRunFiles(command)).pipe(
    Effect.mapError((cause) => StageError.make({ stage: 'dryRun', reason: 'Failed to resolve sandbox file', cause })),
  )
type FailedDryRun = Extract<TestRunner.DryRunResult, { readonly status: 'error' }>
type TimedOutDryRun = Extract<TestRunner.DryRunResult, { readonly status: 'timeout' }>

const failedTestSummariesOf = (
  tests: readonly TestRunner.TestResult[],
): readonly FailedTestSummary[] =>
  tests
    .filter((test): test is TestRunner.FailedTestResult => test.status === 'failed')
    .map((test) => FailedTestSummary.make({ name: test.name, failureMessage: test.failureMessage }))

const commandEncodedComplete = (
  complete: TestRunner.CompleteDryRunResult,
  allowEmpty: boolean,
): typeof DryRunCommand.Encoded => ({
  _tag: 'DryRunCommand',
  status: 'Complete',
  testCount: complete.tests.length,
  failedTestCount: complete.tests.filter((test) => test.status === 'failed').length,
  failedTests: failedTestSummariesOf(complete.tests),
  allowEmpty,
})

const commandEncodedFailed = (
  failed: FailedDryRun,
  allowEmpty: boolean,
): typeof DryRunCommand.Encoded => ({
  _tag: 'DryRunCommand',
  status: 'Error',
  testCount: 0,
  failedTestCount: 0,
  failedTests: [],
  allowEmpty,
  errorMessage: failed.errorMessage,
})

const commandEncodedTimedOut = (
  timedOut: TimedOutDryRun,
  allowEmpty: boolean,
): typeof DryRunCommand.Encoded => ({
  _tag: 'DryRunCommand',
  status: 'Timeout',
  testCount: 0,
  failedTestCount: 0,
  failedTests: [],
  allowEmpty,
  ...(Option.match(Option.fromNullishOr(timedOut.reason), {
    onNone: () => ({}),
    onSome: (reason) => ({ reason }),
  })),
})

const dryRunRaw = (
  prev: InstrumentDone,
  rawResult: TestRunner.DryRunResult,
  capabilities: TestRunner.TestRunnerCapabilities,
  gross: EffectDuration.Duration,
): DryRunRaw =>
  Match.value(rawResult).pipe(
    Match.when(isCompleteDryRun, (complete) => ({
      ...commandEncodedComplete(complete, prev.options.allowEmpty),
      prev,
      rawResult,
      capabilities,
      gross,
    })),
    Match.when(isFailedDryRun, (failed) => ({
      ...commandEncodedFailed(failed, prev.options.allowEmpty),
      prev,
      rawResult,
      capabilities,
      gross,
    })),
    Match.orElse((timedOut) => ({
      ...commandEncodedTimedOut(timedOut, prev.options.allowEmpty),
      prev,
      rawResult,
      capabilities,
      gross,
    })),
  )

const isCompleteDryRun = (result: TestRunner.DryRunResult): result is TestRunner.CompleteDryRunResult =>
  result.status === 'complete'

const isFailedDryRun = (result: TestRunner.DryRunResult): result is FailedDryRun => result.status === 'error'

const totalTestTime = (tests: readonly TestRunner.TestResult[]): number =>
  tests.reduce((total, test) => total + test.timeSpentMs, 0)
const overheadMillisOf = (grossMillis: number, tests: readonly TestRunner.TestResult[]): number =>
  Math.max(0, grossMillis - totalTestTime(tests))

const withOriginalFileName = (test: TestRunner.TestResult, prev: InstrumentDone): TestRunner.TestResult =>
  Match.value(test.fileName).pipe(
    Match.when(Predicate.isString, (fileName) => ({
      ...test,
      fileName: originalFileFor(prev.sandbox, fileName),
    })),
    Match.orElse(() => test),
  )

const withOriginalFileNames = (
  tests: readonly TestRunner.TestResult[],
  prev: InstrumentDone,
): readonly TestRunner.TestResult[] => tests.map((test) => withOriginalFileName(test, prev))

const ZERO = 0

const testsByIdOf = (result: Readonly<TestRunner.CompleteDryRunResult>) =>
  MutableHashMap.fromIterable(result.tests.map((test) => [test.id, test] as const))

const withTestForMutant = (
  testsByMutantId: MutableHashMap.MutableHashMap<string, MutableHashSet.MutableHashSet<TestRunner.TestResult>>,
  mutantId: string,
  test: TestRunner.TestResult,
) =>
  MutableHashMap.set(
    testsByMutantId,
    mutantId,
    MutableHashSet.add(
      Option.getOrElse(MutableHashMap.get(testsByMutantId, mutantId), () =>
        MutableHashSet.empty<TestRunner.TestResult>()),
      test,
    ),
  )

const coveredMutantIdsOf = (coverage: Mutant.CoverageData) =>
  Object.entries(coverage).filter(([, count]) => count > ZERO).map(([mutantId]) => mutantId)

const testsByMutantIdOf = (
  mutantCoverage: Mutant.Coverage,
  testsById: MutableHashMap.MutableHashMap<string, TestRunner.TestResult>,
) =>
  Object.entries(mutantCoverage.perTest).reduce(
    (testsByMutantId, [testId, coverage]) =>
      Option.match(MutableHashMap.get(testsById, testId), {
        onNone: () => testsByMutantId,
        onSome: (test) =>
          coveredMutantIdsOf(coverage).reduce(
            (acc, mutantId) => withTestForMutant(acc, mutantId, test),
            testsByMutantId,
          ),
      }),
    MutableHashMap.empty<string, MutableHashSet.MutableHashSet<TestRunner.TestResult>>(),
  )

const hitsByMutantIdOf = (mutantCoverage: Mutant.Coverage) =>
  [mutantCoverage.static, ...Object.values(mutantCoverage.perTest)].reduce(
    (hitsByMutantId, coverage) =>
      Object.entries(coverage).reduce(
        (acc, [mutantId, count]) =>
          MutableHashMap.set(
            acc,
            mutantId,
            Option.getOrElse(MutableHashMap.get(acc, mutantId), () => ZERO) + count,
          ),
        hitsByMutantId,
      ),
    MutableHashMap.empty<string, number>(),
  )

const testCoverageFrom = (result: Readonly<TestRunner.CompleteDryRunResult>) => {
  const testsById = testsByIdOf(result)
  const mutantCoverage = Option.fromNullishOr(result.mutantCoverage)
  return {
    testsByMutantId: Option.match(mutantCoverage, {
      onNone: () => MutableHashMap.empty<string, MutableHashSet.MutableHashSet<TestRunner.TestResult>>(),
      onSome: (coverage) => testsByMutantIdOf(coverage, testsById),
    }),
    testsById,
    staticCoverage: Option.match(mutantCoverage, {
      onNone: () => undefined,
      onSome: (coverage) => coverage.static,
    }),
    hitsByMutantId: Option.match(mutantCoverage, {
      onNone: () => MutableHashMap.empty<string, number>(),
      onSome: (coverage) => hitsByMutantIdOf(coverage),
    }),
  }
}

const announceDryRunOutcome = (
  tests: readonly TestRunner.TestResult[],
  prev: InstrumentDone,
  gross: EffectDuration.Duration,
  overheadMillis: number,
): Effect.Effect<void> =>
  Match.value(tests.length).pipe(
    Match.when(0, () => Effect.logInfo('No tests were found')),
    Match.orElse(() =>
      Effect.logInfo(
        `Initial test run succeeded. Ran ${tests.length} tests in ${EffectDuration.format(gross)} (net ${
          totalTestTime(tests)
        } ms, overhead ${overheadMillis} ms).`,
      ).pipe(
        Effect.andThen(
          Effect.when(
            Effect.logInfo('Note: running the dry-run only. No mutations will be tested.'),
            Effect.succeed(prev.options.dryRunOnly),
          ),
        ),
      )
    ),
  )

const completeDryRunResultOf = (raw: DryRunRaw, rawResult: TestRunner.CompleteDryRunResult) =>
  Effect.gen(function*() {
    const tests = withOriginalFileNames(rawResult.tests, raw.prev)
    const dryRunResult = { ...rawResult, tests, status: 'complete' } as const
    const overheadMillis = overheadMillisOf(EffectDuration.toMillis(raw.gross), tests)

    yield* offerReporterEvent(
      raw.prev.reporterStage,
      Reporter.DryRunCompleted.make({
        timing: { net: totalTestTime(tests), overhead: overheadMillis },
        capabilities: { reloadEnvironment: raw.capabilities.reloadEnvironment },
        testCount: tests.length,
        tests: [...dryRunResult.tests],
      }),
    ).pipe(Effect.ignoreCause)

    yield* announceDryRunOutcome(tests, raw.prev, raw.gross, overheadMillis)

    return {
      ...raw.prev,
      dryRunResult,
      testCoverage: testCoverageFrom(dryRunResult),
      timeOverhead: EffectDuration.millis(overheadMillis),
    }
  })

const completeDryRunPassed = (raw: DryRunRaw) =>
  Match.value(raw.rawResult).pipe(
    Match.when(isCompleteDryRun, (rawResult) => completeDryRunResultOf(raw, rawResult)),
    Match.orElse(() =>
      Effect.fail(StageError.make({ stage: 'dryRun', reason: 'Unexpected dry-run status after decision' }))
    ),
  )
export const isStageError = (candidate: unknown): candidate is StageError => S.is(StageError)(candidate)

export const readDryRun = (command: InstrumentDone) =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const idGenerator = yield* IdGenerator

    const { files, testFiles } = yield* resolveDryRunFiles(command)
    const dryRunTimeout = command.options.dryRunTimeoutMinutes * 60 * 1000

    yield* Effect.logInfo('Starting dry run')
    const { rawResult, capabilities, gross } = yield* Effect.scoped(
      Effect.gen(function*() {
        const childRunnerEffect = Effect.suspend(() => {
          const runnerConfigured = command.options.testRunner
          return workerSpawnOf('dryRun', command.loadedPlugins, 'TestRunner', configuredPluginOf(runnerConfigured))
            .pipe(
              Effect.flatMap((resolved) =>
                makeChildProcessTestRunner({
                  options: command.options,
                  fileDescriptions: command.project.fileDescriptions,
                  sandboxWorkingDirectory: command.sandbox.workingDirectory,
                  workerEntrypoint: resolved.entrypoint,
                  idGenerator,
                })
              ),
            )
        })

        const runner = yield* buildTestRunner(
          {
            options: command.options,
            fileDescriptions: command.project.fileDescriptions,
            sandboxWorkingDirectory: command.sandbox.workingDirectory,
            idGenerator,
            retire: Effect.void,
            testFiles: testFiles ?? [],
          },
          childRunnerEffect,
        )
        const extra: { testFiles?: readonly string[] } = Option.match(Option.fromUndefinedOr(testFiles), {
          onNone: () => ({}),
          onSome: (files) => ({ testFiles: files }),
        })
        const timed = yield* Effect.timed(
          runner
            .dryRun({
              timeout: dryRunTimeout,
              coverageAnalysis: command.options.coverageAnalysis,
              disableBail: command.options.disableBail,
              files,
              ...extra,
            })
            .pipe(
              Effect.mapError((cause) => StageError.make({ stage: 'dryRun', reason: 'Dry run failed', cause })),
            ),
        )
        const gross = timed[0]
        const rawResult = timed[1]
        const capabilities = yield* runner.capabilities.pipe(
          Effect.mapError((cause) =>
            StageError.make({ stage: 'dryRun', reason: 'Failed to get test runner capabilities', cause })
          ),
        )
        return { rawResult, capabilities, gross }
      }),
    ).pipe(
      Effect.mapError((cause) =>
        Match.value({ cause }).pipe(
          Match.when({ cause: isStageError }, ({ cause }) => cause),
          Match.orElse(({ cause }) =>
            StageError.make({ stage: 'dryRun', reason: 'Dry run failed to start test runner', cause })
          ),
        )
      ),
    )

    return dryRunRaw(command, rawResult, capabilities, gross)
  })

export const writeDryRunPassed = (raw: DryRunRaw): Effect.Effect<
  DryRunDone,
  StageError,
  RunEnvironment | RunEvents
> =>
  withPhaseSpan(
    'dryRun',
    {},
    () =>
      Effect.gen(function*() {
        yield* phaseEntered('dry-run')
        return yield* completeDryRunPassed(raw)
      }),
  )

const FAILED_TESTS_REASON = 'There were failed tests in the initial test run.'

const failedTestsDetail = (failedTests: readonly FailedTestSummary[]): string =>
  failedTests
    .map((test) => `  ${test.name}${test.failureMessage.length > 0 ? `: ${test.failureMessage}` : ''}`)
    .join('\n')

const reasonWithFailedTests = (detail: string): string =>
  detail.length > 0 ? `${FAILED_TESTS_REASON}\n${detail}` : FAILED_TESTS_REASON

export const writeDryRunFailed = ({
  testCount,
  failedTestCount,
  failedTests,
}: {
  readonly testCount: number
  readonly failedTestCount: number
  readonly failedTests: readonly FailedTestSummary[]
}): Effect.Effect<DryRunDone, StageError, RunEnvironment | RunEvents> =>
  withPhaseSpan(
    'dryRun',
    {},
    () =>
      Effect.gen(function*() {
        yield* phaseEntered('dry-run')
        const detail = failedTestsDetail(failedTests)
        yield* Effect.logError(
          `Initial test run failed. ${failedTestCount} of ${testCount} test(s) failed:\n${detail}`,
        )
        return yield* StageError.make({
          stage: 'dryRun',
          reason: reasonWithFailedTests(detail),
          cause: DryRunFailed.make({ testCount, failedTestCount, failedTests }),
        })
      }),
  )
