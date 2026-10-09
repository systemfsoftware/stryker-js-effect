import { type Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Options, type Plugin, Reporter, type TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as EffectDuration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'

import { detectDryRunFlakes, DetectDryRunFlakesCommand } from '../detect-dry-run-flakes.workflow.js'
import { type DryRunCoverage, type DryRunPass } from '../dry-run-coverage.schema.js'
import { dryRun, DryRunCommand, DryRunError, DryRunFailed, FailedTestSummary } from '../dry-run.workflow.js'
import {
  DryRunObservation,
  type DryRunObservationDecision,
  interpretDryRunObservation,
} from '../interpret-dry-run-observation.workflow.js'
import type { LoadedPlugins } from '../Plugins.schema.js'
import { PluginNotFoundError } from '../PluginsError.schema.js'
import { offerReporterEvent, withPhaseSpan } from '../reporter-stream.service.js'
import { type RunEvents, WorkerReports } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { originalFileFor, sandboxFileFor, type SandboxHandle } from '../Sandbox.handle.js'
import type { TestCoverage } from '../test-coverage.schema.js'
import { buildTestRunner, makeChildProcessTestRunner } from '../TestRunner.blueprint.js'
import { testRunnerConfigOf } from '../vm-runner.js'
import { IdGenerator, type IdGeneratorShape } from '../Worker.service.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import { dryRunChoiceOf, testClosureDigestOf } from './dry-run-choice.js'
import { testCoverageOf, testFileModulesFieldOf } from './dry-run-coverage.js'
import type { InstrumentDone } from './instrument.cell.js'
import type { PhaseClock } from './phase-clock.service.js'
import {
  ConfiguredPluginModulePath,
  ConfiguredPluginName,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
  type WorkerSpawnResolved,
} from './resolve-configured-plugin.workflow.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import type { StageServices } from './StageServices.service.js'

export interface DryRunDone extends InstrumentDone {
  readonly dryRunResult: TestRunner.CompleteDryRunResult
  readonly testCoverage: TestCoverage
  readonly timeOverhead: EffectDuration.Duration
  readonly dryRunDeferred: boolean
}

interface DryRunExtras {
  readonly reused?: DryRunCoverage | undefined
  readonly globalTestInputs: readonly string[]
  readonly testFileModules: Readonly<Record<string, readonly string[]>> | undefined
  readonly flakyTestIds: readonly string[]
  readonly flakyMutantIds: readonly string[]
  readonly testClosureDigest: string
  readonly runInputsDigest: string
}

export type DryRunRaw = typeof DryRunCommand.Encoded & {
  readonly prev: InstrumentDone
  readonly rawResult: TestRunner.DryRunResult
  readonly capabilities: TestRunner.TestRunnerCapabilities
  readonly gross: EffectDuration.Duration
} & DryRunExtras

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

const resolveDryRunFiles = Effect.fn(SpanTaxonomy.Spans.dryRunResolveFiles.name)(function*(command: InstrumentDone) {
  return yield* Effect.fromResult(buildDryRunFiles(command)).pipe(
    Effect.mapError((cause) => StageError.make({ stage: 'dryRun', reason: 'Failed to resolve sandbox files', cause })),
  )
})

const originalGlobalInputsOf = (command: InstrumentDone, result: TestRunner.DryRunResult): readonly string[] =>
  Option.getOrElse(
    Option.map(
      Option.liftPredicate(result, (value): value is TestRunner.CompleteDryRunResult => value.status === 'complete'),
      (complete) => (complete.globalTestInputs ?? []).map((file) => originalFileFor(command.sandbox, file)),
    ),
    () => [],
  )

const sandboxOwnsPath = (command: InstrumentDone, value: string): boolean =>
  value.startsWith(`${command.sandbox.workingDirectory}/`)

const originalModuleValuesOf = (
  command: InstrumentDone,
  values: readonly string[],
): Effect.Effect<readonly string[], never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const kept = yield* Effect.forEach(
      values,
      (value) =>
        Boolean.match(sandboxOwnsPath(command, value), {
          onFalse: () => Effect.succeedSome(value),
          onTrue: () => {
            const original = originalFileFor(command.sandbox, value)
            return Effect.map(
              fs.exists(original).pipe(Effect.orElseSucceed(() => false)),
              (exists) => (exists ? Option.some(original) : Option.none()),
            )
          },
        }),
      { concurrency: 16 },
    )
    return Arr.getSomes(kept)
  })

const testFileModulesEntriesOf = (
  command: InstrumentDone,
  modules: Readonly<Record<string, readonly string[]>>,
): Effect.Effect<Option.Option<Readonly<Record<string, readonly string[]>>>, never, FileSystem.FileSystem> =>
  Effect.map(
    Effect.forEach(
      Object.entries(modules),
      ([file, values]) =>
        Effect.map(
          originalModuleValuesOf(command, values),
          (kept) => [originalFileFor(command.sandbox, file), kept] as const,
        ),
      { concurrency: 8 },
    ),
    (entries) => Option.some(Object.fromEntries(entries)),
  )

const originalTestFileModulesOf = (
  command: InstrumentDone,
  result: TestRunner.DryRunResult,
): Effect.Effect<Readonly<Record<string, readonly string[]>> | undefined, never, FileSystem.FileSystem> =>
  Effect.map(
    Option.match(
      Option.flatMap(
        Option.liftPredicate(result, (value): value is TestRunner.CompleteDryRunResult => value.status === 'complete'),
        (complete) => Option.fromUndefinedOr(complete.testFileModules),
      ),
      {
        onNone: () => Effect.succeedNone,
        onSome: (modules) => testFileModulesEntriesOf(command, modules),
      },
    ),
    Option.getOrUndefined,
  )

const rawOf = (
  command: InstrumentDone,
  rawResult: TestRunner.DryRunResult,
  capabilities: TestRunner.TestRunnerCapabilities,
  gross: EffectDuration.Duration,
  extras: DryRunExtras,
): DryRunRaw => {
  const observation = DryRunObservation.make({
    dryRunResult: rawResult,
    allowEmpty: command.options.allowEmpty,
  })
  const decision = Result.getOrElse(interpretDryRunObservation(observation), (never: never) => never)
  return {
    ...dryRunCommandOfDecision(decision, command.options.allowEmpty),
    prev: command,
    rawResult,
    capabilities,
    gross,
    ...extras,
  }
}

const reusedRawOf = (command: InstrumentDone, coverage: DryRunCoverage): DryRunRaw =>
  rawOf(
    command,
    {
      status: 'complete',
      tests: [...coverage.tests],
      globalTestInputs: [...coverage.globalTestInputs],
      ...testFileModulesFieldOf(coverage.testFileModules),
      ...(coverage.mutantCoverage === undefined ? {} : { mutantCoverage: coverage.mutantCoverage }),
    },
    { reloadEnvironment: false },
    EffectDuration.zero,
    {
      reused: coverage,
      globalTestInputs: [...coverage.globalTestInputs],
      testFileModules: coverage.testFileModules,
      flakyTestIds: [...coverage.flakyTestIds],
      flakyMutantIds: [...coverage.flakyMutantIds],
      testClosureDigest: coverage.testClosureDigest,
      runInputsDigest: coverage.runInputsDigest,
    },
  )

const dryRunOptionsOf = (
  command: InstrumentDone,
  files: readonly string[],
  testFiles: readonly string[] | undefined,
  timeout: number,
): TestRunner.DryRunOptions => ({
  timeout,
  coverageAnalysis: command.options.coverageAnalysis,
  disableBail: command.options.disableBail,
  files,
  ...Option.match(Option.fromUndefinedOr(testFiles), {
    onNone: () => ({}),
    onSome: (present) => ({ testFiles: present }),
  }),
})

const completePassOf = (result: TestRunner.DryRunResult): Option.Option<DryRunPass> =>
  Option.map(
    Option.liftPredicate(result, (value): value is TestRunner.CompleteDryRunResult => value.status === 'complete'),
    (complete) => ({
      tests: [...complete.tests],
      ...(complete.mutantCoverage === undefined ? {} : { mutantCoverage: complete.mutantCoverage }),
    }),
  )

interface DryRunFlakes {
  readonly flakyTestIds: readonly string[]
  readonly flakyMutantIds: readonly string[]
}

const NO_FLAKES: DryRunFlakes = { flakyTestIds: [], flakyMutantIds: [] }

const flakesOf = (first: TestRunner.DryRunResult, second: Option.Option<TestRunner.DryRunResult>): DryRunFlakes =>
  Option.match(Option.all([completePassOf(first), Option.flatMap(second, completePassOf)]), {
    onNone: () => NO_FLAKES,
    onSome: ([firstPass, secondPass]) =>
      Match.value(
        Result.getOrElse(
          detectDryRunFlakes(DetectDryRunFlakesCommand.make({ first: firstPass, second: secondPass })),
          (never: never) => never,
        ),
      ).pipe(
        Match.tag('DryRunFlakesDetected', (detected): DryRunFlakes => ({
          flakyTestIds: [...detected.flakyTestIds],
          flakyMutantIds: [...detected.flakyMutantIds],
        })),
        Match.tag('DryRunFlakesAbsent', (): DryRunFlakes => NO_FLAKES),
        Match.exhaustive,
      ),
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

const reportDryRunCompleted = (
  raw: DryRunRaw,
  tests: readonly TestRunner.TestResult[],
  overheadMillis: number,
): Effect.Effect<void> =>
  offerReporterEvent(
    raw.prev.reporterStage,
    Reporter.DryRunCompleted.make({
      timing: { net: totalTestTime(tests), overhead: overheadMillis },
      capabilities: { reloadEnvironment: raw.capabilities.reloadEnvironment },
      testCount: tests.length,
      tests: [...tests],
    }),
  ).pipe(Effect.ignoreCause)

const freshCoverageOf = (
  raw: DryRunRaw,
  dryRunResult: TestRunner.CompleteDryRunResult,
  overheadMillis: number,
): DryRunCoverage => ({
  tests: [...dryRunResult.tests],
  ...(dryRunResult.mutantCoverage === undefined ? {} : { mutantCoverage: dryRunResult.mutantCoverage }),
  globalTestInputs: [...raw.globalTestInputs],
  ...testFileModulesFieldOf(raw.testFileModules),
  timeOverheadMs: overheadMillis,
  flakyTestIds: [...raw.flakyTestIds],
  flakyMutantIds: [...raw.flakyMutantIds],
  testClosureDigest: raw.testClosureDigest,
  runInputsDigest: raw.runInputsDigest,
})

const dryRunDoneOf = (
  raw: DryRunRaw,
  dryRunResult: TestRunner.CompleteDryRunResult,
  coverage: DryRunCoverage,
): DryRunDone => ({
  ...raw.prev,
  dryRunResult,
  testCoverage: testCoverageOf({ result: dryRunResult, dryRunCoverage: coverage }),
  timeOverhead: EffectDuration.millis(coverage.timeOverheadMs),
  dryRunDeferred: false,
})

const completeFreshDryRun = Effect.fnUntraced(function*(
  raw: DryRunRaw,
  dryRunResult: TestRunner.CompleteDryRunResult,
) {
  const overheadMillis = overheadMillisOf(EffectDuration.toMillis(raw.gross), dryRunResult.tests)
  yield* reportDryRunCompleted(raw, dryRunResult.tests, overheadMillis)
  yield* announceDryRunOutcome(dryRunResult.tests, raw.prev, raw.gross, overheadMillis)
  return dryRunDoneOf(raw, dryRunResult, freshCoverageOf(raw, dryRunResult, overheadMillis))
})

const completeDryRunResultOf = Effect.fn(SpanTaxonomy.Spans.dryRunComplete.name)(function*(
  raw: DryRunRaw,
  rawResult: TestRunner.CompleteDryRunResult,
) {
  const tests = withOriginalFileNames(rawResult.tests, raw.prev)
  const dryRunResult = {
    ...rawResult,
    tests,
    status: 'complete',
    ...testFileModulesFieldOf(raw.testFileModules),
  } as const
  return yield* Option.match(Option.fromUndefinedOr(raw.reused), {
    onNone: () => completeFreshDryRun(raw, dryRunResult),
    onSome: (coverage) =>
      Effect.as(
        Effect.logDebug('Reusing the dry-run coverage from the incremental report; skipping the initial test run.'),
        dryRunDoneOf(raw, dryRunResult, coverage),
      ),
  })
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

const runFreshDryRun = Effect.fnUntraced(function*(
  command: InstrumentDone,
  idGenerator: IdGeneratorShape,
  currentTestClosureDigest: Option.Option<string>,
  runInputsDigest: string,
) {
  const env = yield* RunEnvironment
  const reports = yield* WorkerReports
  const { files, testFiles } = yield* resolveDryRunFiles(command)
  const dryRunTimeout = command.options.dryRunTimeoutMinutes * 60 * 1000
  const options = dryRunOptionsOf(command, files, testFiles, dryRunTimeout)

  yield* Effect.logInfo('Starting dry run')

  const { first, second, capabilities, gross } = yield* Effect.scoped(
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

      const startedAt = yield* Clock.currentTimeMillis
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
      yield* reports.report('testRunner', (yield* Clock.currentTimeMillis) - startedAt)
      const capabilities = yield* runner.capabilities.pipe(
        Effect.mapError((cause) =>
          StageError.make({ stage: 'dryRun', reason: 'Failed to get test runner capabilities', cause })
        ),
      )
      const timedPass = Effect.timed(
        runner
          .dryRun(options)
          .pipe(
            Effect.mapError((cause) => StageError.make({ stage: 'dryRun', reason: 'Dry run failed', cause })),
          ),
      )
      const firstPass = yield* timedPass
      const secondPass = yield* Boolean.match(firstPass[1].status === 'complete', {
        onTrue: () => Effect.map(timedPass, Option.some<readonly [EffectDuration.Duration, TestRunner.DryRunResult]>),
        onFalse: () => Effect.succeed(Option.none<readonly [EffectDuration.Duration, TestRunner.DryRunResult]>()),
      })
      return {
        first: firstPass[1],
        second: Option.map(secondPass, ([, result]) => result),
        capabilities,
        gross: firstPass[0],
      }
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

  const flakes = flakesOf(first, second)
  const globalTestInputs = originalGlobalInputsOf(command, first)
  const testFileModules = yield* originalTestFileModulesOf(command, first)
  const testClosureDigest = Option.getOrElse(
    yield* testClosureDigestOf(command, env.basePath, globalTestInputs, testFileModules),
    () => Option.getOrElse(currentTestClosureDigest, () => ''),
  )
  return rawOf(command, first, capabilities, gross, {
    globalTestInputs,
    testFileModules,
    flakyTestIds: flakes.flakyTestIds,
    flakyMutantIds: flakes.flakyMutantIds,
    testClosureDigest,
    runInputsDigest,
  })
})

const readDryRun: (command: InstrumentDone) => Effect.Effect<
  DryRunRaw,
  StageError,
  | Scope.Scope
  | IdGenerator
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | WorkerLauncher
  | RunEnvironment
  | RunEvents
  | WorkerReports
  | PhaseClock
> = Effect.fnUntraced(function*(command: InstrumentDone) {
  yield* Scope.Scope
  const idGenerator = yield* IdGenerator
  const env = yield* RunEnvironment

  const { candidates, prior, decision, currentTestClosureDigest, runInputsDigest } = yield* dryRunChoiceOf(
    command,
    env.basePath,
  )

  yield* Match.value(decision).pipe(
    Match.tag(
      'DryRunCoverageReused',
      () => Effect.logInfo('Reusing the persisted dry-run coverage; skipping the initial test run'),
    ),
    Match.tag(
      'DryRunCoverageStale',
      ({ reason }) =>
        Effect.logInfo(
          [
            `Running the initial test run: dry-run coverage reuse refused (${reason})`,
            `  prior closure digest:     ${
              Option.getOrElse(
                Option.map(prior, (coverage) => coverage.testClosureDigest),
                () => '(no prior coverage)',
              )
            }`,
            `  current closure digest:   ${Option.getOrElse(currentTestClosureDigest, () => '(unavailable)')}`,
            `  prior run-inputs digest:  ${
              Option.getOrElse(
                Option.map(prior, (coverage) => coverage.runInputsDigest),
                () => '(no prior coverage)',
              )
            }`,
            `  prior coverage records:   ${candidates.length}`,
            `  current run-inputs digest: ${runInputsDigest}`,
          ].join('\n'),
        ),
    ),
    Match.exhaustive,
  )

  return yield* Match.value(decision).pipe(
    Match.tag('DryRunCoverageReused', () =>
      Option.match(prior, {
        onNone: () =>
          Effect.die(StageError.make({ stage: 'dryRun', reason: 'Coverage reuse decided without prior coverage' })),
        onSome: (coverage) => Effect.succeed(reusedRawOf(command, coverage)),
      })),
    Match.tag(
      'DryRunCoverageStale',
      () => runFreshDryRun(command, idGenerator, currentTestClosureDigest, runInputsDigest),
    ),
    Match.exhaustive,
  )
})

const writeDryRunPassed = Effect.fn(SpanTaxonomy.Spans.dryRunWritePassed.name)(function*(raw: DryRunRaw) {
  return yield* withPhaseSpan(
    SpanTaxonomy.Spans.dryRunPhase,
    {},
    () => completeDryRunPassed(raw),
  )
})

const FAILED_TESTS_REASON = 'There were failed tests in the initial test run.'

const failedTestsDetail = (failedTests: readonly FailedTestSummary[]): string =>
  failedTests
    .map((test) => `  ${test.name}${test.failureMessage.length > 0 ? `: ${test.failureMessage}` : ''}`)
    .join('\n')

const reasonWithFailedTests = (detail: string): string =>
  detail.length > 0 ? `${FAILED_TESTS_REASON}\n${detail}` : FAILED_TESTS_REASON

const writeDryRunFailed = Effect.fn(SpanTaxonomy.Spans.dryRunWriteFailed.name)(function*({
  testCount,
  failedTestCount,
  failedTests,
}: {
  readonly testCount: number
  readonly failedTestCount: number
  readonly failedTests: readonly FailedTestSummary[]
}) {
  return yield* withPhaseSpan(
    SpanTaxonomy.Spans.dryRunPhase,
    {},
    () =>
      Effect.gen(function*() {
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
  SpanTaxonomy.Spans.dryRun.name,
)(readDryRun).decide(dryRun).write({
  DryRunPassed: (_decision, raw) => writeDryRunPassed(raw),
  DryRunFailed: ({ testCount, failedTestCount, failedTests }, _raw) =>
    writeDryRunFailed({ testCount, failedTestCount, failedTests }),
  DryRunError: ({ stage, reason }) =>
    Effect.fail(StageError.make({ stage, reason, cause: DryRunError.make({ stage, reason }) })),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'dryRun', reason: issue })),
})
