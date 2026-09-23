import type { MutantRunOptions, DryRunOptions, DryRunResult, TestResult } from '@systemfsoftware/stryker-js-plugin-interface'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { TestRunnerFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import { testFilesProvided } from '@systemfsoftware/stryker-js-plugin-interface'
import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  type CoverageData,
  errorToString,
  type MutantCoverage as DryRunMutantCoverage,
  normalizeFileName,
} from '@systemfsoftware/stryker-js-instrumenter'
import type { RunnerTestCase, RunnerTestFile, RunnerTestSuite, RunnerTask } from 'vitest'
import * as Boolean from 'effect/Boolean'
import * as Context from 'effect/Context'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { makeMutantRunCell } from './MutantRun.cell.js'
import { VitestSession, type VitestSessionInput } from './VitestSession.service.js'
import {
  applyRunFilter,
  clearFiles,
  dedupeFilesByName,
  externalErrorText,
  files,
  hasExternalErrors,
  isRunnerTestSuite,
  metaOf,
  reportAllKillersOf,
  start,
} from './VitestRuntime.handle.js'
import { interpretVitestDryRun } from './interpret-vitest-dry-run.workflow.js'
import {
  CoverageDecodeFailed,
  HitCountMetaSchema,
  MutantCoverageMetaSchema,
  MutantCoverageShapeSchema,
  type TestRunnerPhase,
} from './VitestRunner.schema.js'
import { VitestDryRunCommand } from './vitest-run-command.schema.js'

/** Wrap an error value into the runner's failure envelope, keeping a runner failure as-is. */
const asRunnerFailure = (phase: TestRunnerPhase) => <E>(cause: E) =>
  Option.match(Option.liftPredicate(cause, S.is(TestRunnerFailed)), {
    onNone: () => new TestRunnerFailed({ runnerName: 'vitest', phase, cause: errorToString(cause) }),
    onSome: (failed) => failed,
  })

/** The test id parts the sandbox reports: the file it lives in, and its full name. */
const fromTestId = (id: string) => {
  const [file, ...name] = id.split('#')
  return { file, name: name.join('#') }
}

/** The same test id, relative to the project root. */
const normalizeTestId = (id: string, projectRoot: string, pathService: Path.Path) => {
  const { file, name } = fromTestId(id)
  return normalizeFileName(pathService.relative(projectRoot, file)) + '#' + name
}

/** Coverage keyed by project-relative test ids, as the report expects it. */
const normalizeCoverage = (
  rawCoverage: DryRunMutantCoverage,
  projectRoot: string,
  pathService: Path.Path,
): DryRunMutantCoverage => ({
  perTest: Object.fromEntries(
    Object.entries(rawCoverage.perTest).map(([rawTestId, coverageData]) => [
      normalizeTestId(rawTestId, projectRoot, pathService),
      coverageData,
    ]),
  ),
  static: rawCoverage.static,
})

/** Every test in a vitest suite, nested suites included. */
const isSuiteTask = (task: RunnerTask): task is RunnerTestSuite => task.type === 'suite'
const isTestTask = (task: RunnerTask): task is RunnerTestCase => task.type === 'test'

const collectTestsFromSuite = (suite: RunnerTestSuite): readonly RunnerTestCase[] =>
  suite.tasks.flatMap((task) =>
    Option.match(Option.liftPredicate(task, isSuiteTask), {
      onNone: () => Option.toArray(Option.liftPredicate(task, isTestTask)),
      onSome: (nested) => collectTestsFromSuite(nested),
    }))

const VITEST_ERROR_CODES = Object.freeze({
  FILES_NOT_FOUND: 'VITEST_FILES_NOT_FOUND',
})

const isErrorCodeError = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && typeof Reflect.get(error, 'code') === 'string'

export interface RunFilter {
  testIds?: string[]
  relatedFiles?: string[]
  testFiles?: string[]
}

interface RunFilterPlan {
  readonly testNamePattern: RegExp | undefined
  readonly testFiles: string[] | undefined
}

/** Vitest starts every file when the run is not related to a changed file. */
const relatedFilesOf = <A>(relatedValue: A, relatedFiles: readonly string[] | undefined) =>
  Boolean.match(relatedValue !== false, {
    onFalse: () => undefined,
    onTrue: () =>
      Option.getOrUndefined(Option.map(Option.fromNullishOr(relatedFiles), (files) => files.map(normalizeFileName))),
  })

/** A run limited to specific test ids starts exactly those files under a name pattern. */
const testIdPlan = (
  testIds: readonly string[] | undefined,
  projectRoot: string,
  pathService: Path.Path,
) =>
  Option.map(
    Option.filter(Option.fromNullishOr(testIds), (ids) => ids.length > 0),
    (ids): RunFilterPlan => ({
      testNamePattern: new RegExp(ids.map((id) => RegExp.escape(fromTestId(id).name)).join('|')),
      testFiles: ids.map((id) => pathService.resolve(projectRoot, fromTestId(id).file)),
    }),
  )

const runFilterPlan = (filter: RunFilter, projectRoot: string, pathService: Path.Path): RunFilterPlan => {
  const plan = testIdPlan(filter.testIds, projectRoot, pathService)
  return {
    testNamePattern: Option.getOrUndefined(Option.map(plan, (value) => value.testNamePattern)),
    testFiles: Option.match(plan, {
      onNone: () =>
        Option.getOrUndefined(Option.map(Option.fromNullishOr(filter.testFiles), (files) => [...files])),
      onSome: (value) => value.testFiles,
    }),
  }
}

const isMissingTestFilesCause = <E>(cause: E): boolean =>
  isErrorCodeError(cause) && cause.code.includes(VITEST_ERROR_CODES.FILES_NOT_FOUND)

const mergeHitCount = (to: CoverageData, mutantId: string, hitCount: number) =>
  Option.match(Option.fromNullishOr(to[mutantId]), {
    onNone: () => {
      to[mutantId] = hitCount
    },
    onSome: (existing) => {
      to[mutantId] = existing + hitCount
    },
  })

const mergeCoverage = (to: CoverageData, from: CoverageData) => {
  Object.entries(from).forEach(([mutantId, hitCount]) => mergeHitCount(to, mutantId, hitCount))
}

/** The TestRunner this package serves: vitest in a sandbox, one session per worker. */
export const layer = (
  input: VitestSessionInput,
): Layer.Layer<TestRunner, never, Crypto.Crypto | FileSystem.FileSystem | Path.Path> =>
  Layer.effect(TestRunner, makeRunner(input)).pipe(Layer.provide(VitestSession.layer(input)))

const makeRunner = (input: VitestSessionInput) =>
  Effect.gen(function*() {
    const session = yield* VitestSession
    const pathService = yield* Path.Path
    const projectRoot = input.sandboxDirectory
    const runtime = session.runtime
    const vitestOptions = session.options

    const resetContext = Effect.flatMap(runtime, (self) => Effect.sync(() => clearFiles(self)))

    const readHitCount = Effect.gen(function*() {
      const self = yield* runtime.pipe(Effect.mapError((cause) => new CoverageDecodeFailed({ cause })))
      const hitCounts = yield* Effect.forEach(files(self), (file) =>
        S.decodeUnknownEffect(HitCountMetaSchema)(metaOf(file)).pipe(
          Effect.mapError((cause) => new CoverageDecodeFailed({ cause })),
          Effect.orElseSucceed(() => ({ hitCount: undefined })),
          Effect.map((decoded) => Option.getOrElse(Option.fromNullishOr(decoded.hitCount), () => 0)),
        ))
      return hitCounts.reduce((total, count) => total + count, 0)
    })

    const validateCoverage = (coverage: DryRunMutantCoverage) => {
      const normalized = normalizeCoverage(coverage, projectRoot, pathService)
      return S.decodeEffect(MutantCoverageShapeSchema)(normalized).pipe(
        Effect.mapError((cause) => new CoverageDecodeFailed({ cause })),
        Effect.map(() => normalized),
      )
    }

    const coverageOfFile = (file: RunnerTestFile) =>
      Effect.gen(function*() {
        const decoded = yield* S.decodeUnknownEffect(MutantCoverageMetaSchema)(metaOf(file)).pipe(
          Effect.mapError((cause) => new CoverageDecodeFailed({ cause })),
          Effect.orElseSucceed(() => ({ mutantCoverage: undefined })),
        )
        return yield* Option.match(Option.fromNullishOr(decoded.mutantCoverage), {
          onNone: () => Effect.succeedNone,
          onSome: (coverage) => Effect.asSome(validateCoverage(coverage)),
        })
      })

    const mergeTestCoverage = (perTest: Record<string, CoverageData>, testId: string, coverage: CoverageData) =>
      Option.match(Option.fromNullishOr(perTest[testId]), {
        onNone: () => {
          perTest[testId] = coverage
        },
        onSome: (existing) => {
          mergeCoverage(existing, coverage)
        },
      })

    const mergeProjectCoverage = (into: DryRunMutantCoverage, coverage: DryRunMutantCoverage) => {
      Object.entries(coverage.perTest).forEach(([testId, perTest]) => mergeTestCoverage(into.perTest, testId, perTest))
      mergeCoverage(into.static, coverage.static)
      return into
    }

    const readMutantCoverage = Effect.gen(function*() {
      const self = yield* runtime.pipe(Effect.mapError((cause) => new CoverageDecodeFailed({ cause })))
      const runFiles = self.pipe(files, dedupeFilesByName, Object.values)
      const present = yield* Effect.forEach(runFiles, coverageOfFile).pipe(
        Effect.map((results) => results.flatMap(Option.toArray)),
      )
      return Option.match(Option.fromUndefinedOr(present[0]), {
        onNone: () => undefined,
        onSome: (first) => present.slice(1).reduce(mergeProjectCoverage, first),
      })
    })

    const collectRaw = (filter: RunFilter) =>
      Effect.gen(function*() {
        const self = yield* runtime
        const options = yield* vitestOptions
        yield* resetContext
        const related = relatedFilesOf(options.related, filter.relatedFiles)
        const plan = runFilterPlan(filter, projectRoot, pathService)
        yield* applyRunFilter(self, { related, testNamePattern: plan.testNamePattern })
        yield* start(self, plan.testFiles).pipe(
          Effect.catchIf(
            (error: TestRunnerFailed) => isMissingTestFilesCause(error.cause),
            () => Effect.annotateCurrentSpan({ 'stryker.vitest.start_missing_files': true }).pipe(Effect.asVoid),
          ),
          Effect.catchIf(
            (error: TestRunnerFailed) => !isMissingTestFilesCause(error.cause),
            (error) =>
              Effect.annotateCurrentSpan({ 'stryker.vitest.start_errored': true }).pipe(
                Effect.flatMap(() => Effect.fail(error)),
              ),
          ),
        )
        yield* Effect.annotateCurrentSpan({
          'stryker.vitest.start_filter_count': plan.testFiles === undefined ? -1 : plan.testFiles.length,
        })
        const allFiles = files(self)
        const rawTests = allFiles
          .flatMap((file) =>
            Option.getOrElse(
              Option.map(Option.liftPredicate(file, isRunnerTestSuite), collectTestsFromSuite),
              () => [],
            ),
          )
          .filter((test) => test.result !== undefined)
        const externalError = hasExternalErrors(self)
        yield* Effect.annotateCurrentSpan({
          'stryker.vitest.file_count': allFiles.length,
          'stryker.vitest.raw_test_count': rawTests.length,
          'stryker.vitest.has_external_error': externalError,
        })
        return {
          rawTests,
          hasExternalError: externalError,
          externalErrorText: Boolean.match(externalError, { onTrue: () => externalErrorText(self), onFalse: () => '' }),
        }
      })

    const mutantRunCell = Cell.provideContext(
      makeMutantRunCell({
        collectRaw,
        hitCount: readHitCount.pipe(Effect.orElseSucceed(() => undefined)),
        reportAllKillers: reportAllKillersOf(input.options),
        projectRoot,
        vitestOptions,
      }),
      Context.make(VitestSession, session),
    )

    const dryRunFilter = (options: DryRunOptions): RunFilter => {
      const relatedFiles = Option.getOrUndefined(
        Option.map(Option.fromNullishOr(options.files), (files) => [...files]),
      )
      return Boolean.match(testFilesProvided(options), {
        onFalse: () => ({ relatedFiles }),
        onTrue: () => ({
          relatedFiles,
          testFiles: Option.getOrElse(
            Option.map(Option.fromNullishOr(options.testFiles), (files) => [...files]),
            () => [],
          ),
        }),
      })
    }

    const completeDryRun = (tests: readonly TestResult[]) =>
      Effect.gen(function*() {
        const mutantCoverage = yield* readMutantCoverage.pipe(Effect.mapError(asRunnerFailure('dryRun')))
        yield* Effect.annotateCurrentSpan({
          'stryker.vitest.test_count': tests.length,
          'stryker.vitest.has_mutant_coverage': mutantCoverage !== undefined,
        })
        return Option.match(Option.fromNullishOr(mutantCoverage), {
          onNone: (): DryRunResult => ({ status: 'complete', tests }),
          onSome: (coverage): DryRunResult => ({ status: 'complete', tests, mutantCoverage: coverage }),
        })
      })

    const dryRun = (options: DryRunOptions) =>
      session.setMode('dry-run').pipe(
        Effect.andThen(Effect.gen(function*() {
          const { rawTests, hasExternalError, externalErrorText: errorText } = yield* collectRaw(
            dryRunFilter(options),
          )
          const decision = interpretVitestDryRun(
            yield* S.decodeEffect(VitestDryRunCommand)({
              _tag: 'VitestDryRunCommand',
              projectRoot,
              tests: { projectRoot, records: rawTests },
              hasExternalError,
              externalErrorText: errorText,
            }),
          )
          return yield* Result.match(decision, {
            onFailure: (failure) => Effect.fail(failure),
            onSuccess: (outcome) =>
              Match.value(outcome).pipe(
                Match.tag('Error', (error) => Effect.succeed({ status: 'error' as const, errorMessage: error.errorMessage })),
                Match.tag('Complete', (complete) => completeDryRun(complete.tests)),
                Match.exhaustive,
              ),
          })
        })),
        Effect.mapError(asRunnerFailure('dryRun')),
      )

    const mutantRun = (options: MutantRunOptions) =>
      mutantRunCell.run(options).pipe(Effect.mapError(asRunnerFailure('mutantRun')))

    const capabilities = Effect.succeed({ reloadEnvironment: true })
    const initialized = runtime.pipe(Effect.asVoid)

    return TestRunner.of({
      capabilities: initialized.pipe(Effect.andThen(capabilities)),
      init: initialized,
      dryRun: (options) => initialized.pipe(Effect.andThen(dryRun(options))),
      mutantRun: (options) => initialized.pipe(Effect.andThen(mutantRun(options))),
      dispose: session.close,
    })
  })
