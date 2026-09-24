import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { DryRunCompleted, isCustomTestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import type {
  CompleteDryRunResult,
  DryRunResult,
  TestResult,
  TestRunnerCapabilities,
  WorkerPluginKind,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as EffectDuration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import { PhaseEntered, RunEvents } from '../run-events.service.js'

import { dryRun, DryRunCommand, DryRunError, DryRunFailed } from '../dry-run.workflow.js'
import { testCoverageFrom } from '../Mutants.js'
import { PluginNotFoundError } from '../PluginsError.schema.js'
import type { LoadedPlugins } from '../Plugins.schema.js'
import type { TestCoverage } from '../test-coverage.schema.js'
import { offerReporterEvent, withPhaseSpan } from '../reporter-stream.service.js'
import type { SandboxHandle } from '../Sandbox.handle.js'
import { StageError } from '../Run.schema.js'
import { buildTestRunner, makeChildProcessTestRunner } from '../TestRunner.resource.js'
import { IdGenerator } from '../Worker.service.js'
import type { InstrumentDone } from './instrument.cell.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import {
  ConfiguredPluginModulePath,
  ConfiguredPluginName,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
  type WorkerSpawnResolved,
} from './resolve-configured-plugin.workflow.js'

export interface DryRunDone extends InstrumentDone {
  readonly dryRunResult: CompleteDryRunResult
  readonly testCoverage: TestCoverage
  readonly timeOverhead: EffectDuration.Duration
}

const sandboxPathsOf = (sandbox: SandboxHandle, fileNames: readonly string[]) =>
  Result.all(fileNames.map((fileName) => sandbox.sandboxFileFor(fileName)))

const configuredPluginOf = (configured: string | { readonly plugin: string }) =>
  Match.value(configured).pipe(
    Match.when(isCustomTestRunner, (custom) => ConfiguredPluginModulePath.make({ modulePath: custom.plugin })),
    Match.orElse((name) => ConfiguredPluginName.make({ name })),
  )

const workerSpawnOf = (
  stage: StageError['stage'],
  loaded: Pick<LoadedPlugins, 'pluginSources'>,
  kind: WorkerPluginKind,
  configured: ConfiguredPluginName | ConfiguredPluginModulePath,
): Effect.Effect<WorkerSpawnResolved, StageError> =>
  Effect.mapError(
    Effect.fromResult(
      resolveConfiguredPlugin(WorkerSpawnCommand.make({ sources: loaded.pluginSources, kind, configured })),
    ),
    (missing) =>
      StageError.make({ stage, reason: missing.reason, cause: PluginNotFoundError.make({ descriptor: missing.descriptor }) }),
  )

const optionalSandboxPathsOf = (command: InstrumentDone) =>
  Boolean.match(command.project.testFiles.length === 0, {
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
type FailedDryRun = Extract<DryRunResult, { readonly status: 'error' }>
type TimedOutDryRun = Extract<DryRunResult, { readonly status: 'timeout' }>

type DryRunRaw = typeof DryRunCommand.Encoded & {
  readonly prev: InstrumentDone
  readonly rawResult: DryRunResult
  readonly capabilities: TestRunnerCapabilities
  readonly gross: EffectDuration.Duration
}

const commandEncodedComplete = (
  complete: CompleteDryRunResult,
  allowEmpty: boolean,
): typeof DryRunCommand.Encoded => ({
  _tag: 'DryRunCommand',
  status: 'Complete',
  testCount: complete.tests.length,
  failedTestCount: complete.tests.filter((test) => test.status === 'failed').length,
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
  allowEmpty,
  ...(Option.match(Option.fromNullishOr(timedOut.reason), {
    onNone: () => ({}),
    onSome: (reason) => ({ reason }),
  })),
})

const dryRunRaw = (
  prev: InstrumentDone,
  rawResult: DryRunResult,
  capabilities: TestRunnerCapabilities,
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

const isCompleteDryRun = (result: DryRunResult): result is CompleteDryRunResult => result.status === 'complete'

const isFailedDryRun = (result: DryRunResult): result is FailedDryRun => result.status === 'error'

const totalTestTime = (tests: readonly TestResult[]): number =>
  tests.reduce((total, test) => total + test.timeSpentMs, 0)
const overheadMillisOf = (grossMillis: number, tests: readonly TestResult[]): number =>
  Math.max(0, grossMillis - totalTestTime(tests))

const withOriginalFileName = (test: TestResult, prev: InstrumentDone): TestResult =>
  Match.value(test.fileName).pipe(
    Match.when(Predicate.isString, (fileName) => ({
      ...test,
      fileName: prev.sandbox.originalFileFor(fileName),
    })),
    Match.orElse(() => test),
  )

const withOriginalFileNames = (tests: readonly TestResult[], prev: InstrumentDone): readonly TestResult[] =>
  tests.map((test) => withOriginalFileName(test, prev))

const announceDryRunOutcome = (
  tests: readonly TestResult[],
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

const completeDryRunResultOf = (raw: DryRunRaw, rawResult: CompleteDryRunResult) =>
  Effect.gen(function*() {
    const tests = withOriginalFileNames(rawResult.tests, raw.prev)
    const dryRunResult = { ...rawResult, tests, status: 'complete' } as const
    const overheadMillis = overheadMillisOf(EffectDuration.toMillis(raw.gross), tests)

    yield* offerReporterEvent(
      raw.prev.reporterStage,
      DryRunCompleted.make({
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
      Effect.fail(StageError.make({ stage: 'dryRun', reason: 'Unexpected dry-run status after decision' }))),
  )
const isStageError = (candidate: unknown): candidate is StageError => S.is(StageError)(candidate)

const readDryRun = (command: InstrumentDone) =>
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
          return workerSpawnOf('dryRun', command.loadedPlugins, 'TestRunner', configuredPluginOf(runnerConfigured)).pipe(
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
            StageError.make({ stage: 'dryRun', reason: 'Dry run failed to start test runner', cause })),
        )
      ),
    )

    return dryRunRaw(command, rawResult, capabilities, gross)
  })

const emitDryRunPhase = (): Effect.Effect<void, never, RunEnvironment | RunEvents> =>
  Effect.gen(function*() {
    const env = yield* RunEnvironment
    const now = yield* Clock.currentTimeMillis
    const queue = yield* RunEvents
    yield* Queue.offer(queue, PhaseEntered.make({ phase: 'dry-run', elapsedMs: now - env.runStartedAt }))
  })

const writeDryRunPassed = (raw: DryRunRaw): Effect.Effect<
  DryRunDone,
  StageError,
  RunEnvironment | RunEvents
> =>
  withPhaseSpan(
    'dryRun',
    {},
    () =>
      Effect.gen(function*() {
        yield* emitDryRunPhase()
        return yield* completeDryRunPassed(raw)
      }),
  )

const writeDryRunFailed = (
  raw: DryRunRaw,
  testCount: number,
  failedTestCount: number,
): Effect.Effect<DryRunDone, StageError, RunEnvironment | RunEvents> =>
  withPhaseSpan(
    'dryRun',
    {},
    () =>
      Effect.gen(function*() {
        yield* emitDryRunPhase()
        return yield* StageError.make({
          stage: 'dryRun',
          reason: 'There were failed tests in the initial test run.',
          cause: DryRunFailed.make({ testCount, failedTestCount }),
        })
      }),
  )

export const dryRunCell = Sandwich.named('stryker.dry_run')(readDryRun).decide(dryRun).write({
  DryRunPassed: (_decision, raw) => writeDryRunPassed(raw),
  DryRunFailed: ({ testCount, failedTestCount }, raw) => writeDryRunFailed(raw, testCount, failedTestCount),
  DryRunError: ({ stage, reason }) =>
    Effect.fail(StageError.make({ stage, reason, cause: DryRunError.make({ stage, reason }) })),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'dryRun', reason: issue })),
})
