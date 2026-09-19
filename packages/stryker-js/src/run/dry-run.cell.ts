import { Cell } from '@systemfsoftware/effect-cell-types'
import { DryRunCompleted } from '@systemfsoftware/stryker-js-plugin-interface'
import type {
  CompleteDryRunResult,
  DryRunResult,
  TestResult,
  TestRunnerCapabilities,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import { PhaseEntered } from '../RunEvents.js'
import { RunEvents } from '../RunEvents.js'

import { dryRun, DryRunCommand } from '../dry-run.workflow.js'
import { testCoverageFrom } from '../Mutants.js'
import type { TestCoverage } from '../Mutants.js'
import { missingWorkerEntry, resolvePluginWorkerEntry } from '../plugin-worker-entry.js'
import { resolveConfiguredWorkerName } from '../Plugins.js'
import { offerReporterEvent, withPhaseSpan } from '../ReporterStream.js'
import { StageError } from '../Run.schema.js'
import { buildTestRunner, makeChildProcessTestRunner } from '../TestRunner.js'
import { IdGenerator } from '../Worker.js'
import type { InstrumentDone } from './instrument.cell.js'
import { RunEnvironment } from './RunEnvironment.js'

export interface DryRunDone extends InstrumentDone {
  readonly dryRunResult: CompleteDryRunResult
  readonly testCoverage: TestCoverage
  readonly timeOverhead: Duration.Duration
}

function buildDryRunFiles(prev: InstrumentDone): { files: string[]; testFiles: string[] | undefined } {
  const files = [...MutableHashMap.keys(prev.project.filesToMutate)].map((name) => prev.sandbox.sandboxFileFor(name))
  let testFiles: string[] | undefined
  if (prev.project.testFiles.length > 0) {
    testFiles = prev.project.testFiles.map((file) => prev.sandbox.sandboxFileFor(file))
  }
  return { files, testFiles }
}
export interface DryRunRaw {
  readonly prev: InstrumentDone
  readonly rawResult: DryRunResult
  readonly capabilities: TestRunnerCapabilities
  readonly gross: Duration.Duration
}

type FailedDryRun = Extract<DryRunResult, { readonly status: 'error' }>
type TimedOutDryRun = Extract<DryRunResult, { readonly status: 'timeout' }>

const isCompleteDryRun = (result: DryRunResult): result is CompleteDryRunResult => result.status === 'complete'

const isFailedDryRun = (result: DryRunResult): result is FailedDryRun => result.status === 'error'

const decodeCompleteDryRun = (
  result: CompleteDryRunResult,
  allowEmpty: boolean,
): Result.Result<DryRunCommand, StageError> =>
  Result.succeed(
    DryRunCommand.make({
      status: 'Complete',
      testCount: result.tests.length,
      failedTestCount: result.tests.filter((test) => test.status === 'failed').length,
      allowEmpty,
    }),
  )

const decodeFailedDryRun = (
  result: FailedDryRun,
  allowEmpty: boolean,
): Result.Result<DryRunCommand, StageError> =>
  Result.succeed(
    DryRunCommand.make({
      status: 'Error',
      testCount: 0,
      failedTestCount: 0,
      allowEmpty,
      errorMessage: result.errorMessage,
    }),
  )

const decodeTimedOutDryRun = (
  result: TimedOutDryRun,
  allowEmpty: boolean,
): Result.Result<DryRunCommand, StageError> =>
  Result.succeed(
    DryRunCommand.make({
      status: 'Timeout',
      testCount: 0,
      failedTestCount: 0,
      allowEmpty,
      ...(result.reason !== undefined && { reason: result.reason }),
    }),
  )

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
  gross: Duration.Duration,
  overheadMillis: number,
): Effect.Effect<void> =>
  Match.value(tests.length).pipe(
    Match.when(0, () => Effect.logInfo('No tests were found')),
    Match.orElse(() =>
      Effect.logInfo(
        `Initial test run succeeded. Ran ${tests.length} tests in ${Duration.format(gross)} (net ${
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

const completeDryRunPassed = (raw: DryRunRaw): Effect.Effect<DryRunDone, StageError> =>
  Effect.gen(function*() {
    const prevDone = raw.prev
    const rawResult = raw.rawResult

    if (rawResult.status !== 'complete') {
      return yield* StageError.make({ stage: 'dryRun', reason: 'Unexpected dry-run status after decision' })
    }
    const tests = withOriginalFileNames(rawResult.tests, prevDone)
    const dryRunResult: CompleteDryRunResult = { ...rawResult, tests, status: 'complete' }
    const overheadMillis = overheadMillisOf(Duration.toMillis(raw.gross), tests)

    yield* offerReporterEvent(
      prevDone.reporterStage,
      DryRunCompleted.make({
        timing: { net: totalTestTime(tests), overhead: overheadMillis },
        capabilities: { reloadEnvironment: raw.capabilities.reloadEnvironment },
        testCount: tests.length,
        tests: [...dryRunResult.tests],
      }),
    ).pipe(Effect.ignoreCause)

    yield* announceDryRunOutcome(tests, prevDone, raw.gross, overheadMillis)

    return {
      ...prevDone,
      dryRunResult,
      testCoverage: testCoverageFrom(dryRunResult),
      timeOverhead: Duration.millis(overheadMillis),
    }
  })

export const dryRunCell = Cell.layer({
  read: (command: InstrumentDone) =>
    Effect.gen(function*() {
      yield* Scope.Scope
      const idGenerator = yield* IdGenerator

      const { files, testFiles } = buildDryRunFiles(command)
      const dryRunTimeout = command.options.dryRunTimeoutMinutes * 60 * 1000

      yield* Effect.logInfo('Starting dry run')
      const { rawResult, capabilities, gross } = yield* Effect.scoped(
        Effect.gen(function*() {
          const childRunnerEffect = Effect.suspend(() => {
            const runnerConfigured = command.options.testRunner
            const runnerLabel = typeof runnerConfigured === 'string' ? runnerConfigured : runnerConfigured.plugin
            return resolveConfiguredWorkerName(
              command.loadedPlugins.pluginSources,
              'TestRunner',
              runnerConfigured,
            ).pipe(
              Effect.mapError(missingWorkerEntry('dryRun', 'test runner', runnerLabel)),
              Effect.flatMap((runnerName) =>
                resolvePluginWorkerEntry({
                  loaded: command.loadedPlugins,
                  kind: 'TestRunner',
                  name: runnerName,
                }).pipe(
                  Effect.mapError(missingWorkerEntry('dryRun', 'test runner', runnerName)),
                  Effect.flatMap((runnerEntry) =>
                    makeChildProcessTestRunner({
                      options: command.options,
                      fileDescriptions: command.project.fileDescriptions,
                      sandboxWorkingDirectory: command.sandbox.workingDirectory,
                      workerEntrypoint: runnerEntry.entrypoint,
                      idGenerator,
                    })
                  ),
                )
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
          const gross: Duration.Duration = timed[0]
          const rawResult = timed[1]
          const capabilities = yield* runner.capabilities.pipe(
            Effect.mapError((cause) =>
              StageError.make({ stage: 'dryRun', reason: 'Failed to get test runner capabilities', cause })
            ),
          )
          return { rawResult, capabilities, gross }
        }),
      ).pipe(
        Effect.mapError((cause) => {
          if (S.is(StageError)(cause)) {
            return cause
          }
          return StageError.make({ stage: 'dryRun', reason: 'Dry run failed to start test runner', cause })
        }),
      )

      const raw: DryRunRaw = {
        prev: command,
        rawResult,
        capabilities,
        gross,
      }
      return raw
    }),
  decode: (raw: DryRunRaw): Result.Result<DryRunCommand, StageError> =>
    Match.value(raw.rawResult).pipe(
      Match.when(isCompleteDryRun, (complete) => decodeCompleteDryRun(complete, raw.prev.options.allowEmpty)),
      Match.when(isFailedDryRun, (failed) => decodeFailedDryRun(failed, raw.prev.options.allowEmpty)),
      Match.orElse((timedOut) => decodeTimedOutDryRun(timedOut, raw.prev.options.allowEmpty)),
    ),
  decide: dryRun,
  encode: (outcome) => outcome,
  write: (outcome, raw) =>
    withPhaseSpan(
      'dryRun',
      {},
      () =>
        Effect.gen(function*() {
          const env = yield* RunEnvironment
          const now = yield* Clock.currentTimeMillis
          const queue = yield* RunEvents
          yield* Queue.offer(queue, PhaseEntered.make({ phase: 'dry-run', elapsedMs: now - env.runStartedAt }))

          const out = outcome
          if (Result.isFailure(out)) {
            const err = out.failure
            return yield* StageError.make({ stage: err.stage, reason: err.reason, cause: err })
          }
          return yield* Match.value(out.success).pipe(
            Match.tag('DryRunFailed', (decision) =>
              Effect.fail(
                StageError.make({
                  stage: 'dryRun',
                  reason: 'There were failed tests in the initial test run.',
                  cause: decision,
                }),
              )),
            Match.tag('DryRunPassed', () => completeDryRunPassed(raw)),
            Match.exhaustive,
          )
        }),
    ),
})
