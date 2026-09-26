import { type Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Options, type Plugin, Reporter, type TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as EffectDuration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

import { dryRun, DryRunCommand, DryRunError, DryRunFailed, FailedTestSummary } from '../dry-run.workflow.js'
import {
  DryRunObservation,
  type DryRunObservationDecision,
  interpretDryRunObservation,
} from '../interpret-dry-run-observation.workflow.js'
import type { LoadedPlugins } from '../Plugins.schema.js'
import { PluginNotFoundError } from '../PluginsError.schema.js'
import { offerReporterEvent, withPhaseSpan } from '../reporter-stream.service.js'
import { StageError } from '../Run.schema.js'
import { originalFileFor, sandboxFileFor, type SandboxHandle } from '../Sandbox.handle.js'
import type { TestCoverage } from '../test-coverage.schema.js'
import { buildTestRunner, makeChildProcessTestRunner } from '../TestRunner.blueprint.js'
import { testRunnerConfigOf } from '../vm-runner.js'
import { IdGenerator } from '../Worker.service.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import type { InstrumentDone } from './instrument.cell.js'
import {
  ConfiguredPluginModulePath,
  ConfiguredPluginName,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
  type WorkerSpawnResolved,
} from './resolve-configured-plugin.workflow.js'
import { phaseEntered } from './RunEnvironment.service.js'
import type { StageServices } from './StageServices.service.js'

export interface DryRunDone extends InstrumentDone {
  readonly dryRunResult: TestRunner.CompleteDryRunResult
  readonly testCoverage: TestCoverage
  readonly timeOverhead: EffectDuration.Duration
}

export type DryRunRaw = typeof DryRunCommand.Encoded & {
  readonly prev: InstrumentDone
  readonly rawResult: TestRunner.DryRunResult
  readonly capabilities: TestRunner.TestRunnerCapabilities
  readonly gross: EffectDuration.Duration
}

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

const mutatableFilesOf = (command: InstrumentDone): readonly string[] => {
  const mutated = MutableHashSet.fromIterable(command.mutants.map((mutant) => mutant.fileName))
  return [...MutableHashMap.keys(command.project.filesToMutate)].filter((name) => MutableHashSet.has(mutated, name))
}

const buildDryRunFiles = (command: InstrumentDone) =>
  Result.flatMap(
    sandboxPathsOf(command.sandbox, mutatableFilesOf(command)),
    (files) =>
      Result.map(
        Boolean.match(command.options.testFiles.length === 0, {
          onTrue: () => Result.succeed<readonly string[] | undefined>(undefined),
          onFalse: () => sandboxPathsOf(command.sandbox, command.project.testFiles),
        }),
        (testFiles) => ({ files, testFiles }),
      ),
  )

const resolveDryRunFiles = Effect.fn('stryker.dry_run.resolve_files')(function*(command: InstrumentDone) {
  return yield* Effect.fromResult(buildDryRunFiles(command)).pipe(
    Effect.mapError((cause) => StageError.make({ stage: 'dryRun', reason: 'Failed to resolve sandbox file', cause })),
  )
})

const dryRunCommandOfDecision = (
  decision: DryRunObservationDecision,
  allowEmpty: boolean,
): typeof DryRunCommand.Encoded =>
  Match.value(decision).pipe(
    Match.tag('DryRunObservedComplete', ({ testCount, failedTestCount, failedTests }) => ({
      _tag: 'DryRunCommand' as const,
      status: 'Complete' as const,
      testCount,
      failedTestCount,
      failedTests,
      allowEmpty,
    })),
    Match.tag('DryRunObservedFailed', ({ errorMessage }) => ({
      _tag: 'DryRunCommand' as const,
      status: 'Error' as const,
      testCount: 0,
      failedTestCount: 0,
      failedTests: [],
      allowEmpty,
      errorMessage,
    })),
    Match.tag('DryRunObservedTimedOut', ({ reason }) => ({
      _tag: 'DryRunCommand' as const,
      status: 'Timeout' as const,
      testCount: 0,
      failedTestCount: 0,
      failedTests: [],
      allowEmpty,
      ...Option.match(Option.fromUndefinedOr(reason), {
        onNone: () => ({}),
        onSome: (present) => ({ reason: present }),
      }),
    })),
    Match.exhaustive,
  )

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
            (acc, mutantId) =>
              MutableHashMap.set(
                acc,
                mutantId,
                MutableHashSet.add(
                  Option.getOrElse(MutableHashMap.get(acc, mutantId), () =>
                    MutableHashSet.empty<TestRunner.TestResult>()),
                  test,
                ),
              ),
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

const completeDryRunResultOf = Effect.fn('stryker.dry_run.complete')(function*(
  raw: DryRunRaw,
  rawResult: TestRunner.CompleteDryRunResult,
) {
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
    Match.discriminator('status')('complete', (rawResult) => completeDryRunResultOf(raw, rawResult)),
    Match.discriminator('status')('error', () =>
      Effect.fail(StageError.make({ stage: 'dryRun', reason: 'Unexpected dry-run status after decision' }))),
    Match.discriminator('status')('timeout', () =>
      Effect.fail(StageError.make({ stage: 'dryRun', reason: 'Unexpected dry-run status after decision' }))),
    Match.exhaustive,
  )

const readDryRun: (command: InstrumentDone) => Effect.Effect<
  DryRunRaw,
  StageError,
  Scope.Scope | IdGenerator | ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | WorkerLauncher
> = Effect.fnUntraced(function*(command: InstrumentDone) {
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
        onSome: (present) => ({ testFiles: present }),
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
        Match.when(
          { cause: (candidate: unknown): candidate is StageError => S.is(StageError)(candidate) },
          ({ cause }) => cause,
        ),
        Match.orElse(({ cause }) =>
          StageError.make({ stage: 'dryRun', reason: 'Dry run failed to start test runner', cause })
        ),
      )
    ),
  )

  const observation = DryRunObservation.make({
    dryRunResult: rawResult,
    allowEmpty: command.options.allowEmpty,
  })
  const decision = yield* Effect.fromResult(interpretDryRunObservation(observation))
  return {
    ...dryRunCommandOfDecision(decision, command.options.allowEmpty),
    prev: command,
    rawResult,
    capabilities,
    gross,
  }
})

const writeDryRunPassed = Effect.fn('stryker.dry_run.write_passed')(function*(raw: DryRunRaw) {
  return yield* withPhaseSpan(
    'dryRun',
    {},
    () =>
      Effect.gen(function*() {
        yield* phaseEntered('dry-run')
        return yield* completeDryRunPassed(raw)
      }),
  )
})

const FAILED_TESTS_REASON = 'There were failed tests in the initial test run.'

const failedTestsDetail = (failedTests: readonly FailedTestSummary[]): string =>
  failedTests
    .map((test) => `  ${test.name}${test.failureMessage.length > 0 ? `: ${test.failureMessage}` : ''}`)
    .join('\n')

const reasonWithFailedTests = (detail: string): string =>
  detail.length > 0 ? `${FAILED_TESTS_REASON}\n${detail}` : FAILED_TESTS_REASON

const writeDryRunFailed = Effect.fn('stryker.dry_run.write_failed')(function*({
  testCount,
  failedTestCount,
  failedTests,
}: {
  readonly testCount: number
  readonly failedTestCount: number
  readonly failedTests: readonly FailedTestSummary[]
}) {
  return yield* withPhaseSpan(
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
})

export const dryRunCell: Cell.Cell<InstrumentDone, DryRunDone, StageError, StageServices> = Sandwich.named(
  'stryker.dry_run',
)(readDryRun).decide(dryRun).write({
  DryRunPassed: (_decision, raw) => writeDryRunPassed(raw),
  DryRunFailed: ({ testCount, failedTestCount, failedTests }, _raw) =>
    writeDryRunFailed({ testCount, failedTestCount, failedTests }),
  DryRunError: ({ stage, reason }) =>
    Effect.fail(StageError.make({ stage, reason, cause: DryRunError.make({ stage, reason }) })),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'dryRun', reason: issue })),
})
