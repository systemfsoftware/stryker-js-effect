import { Cell } from '@systemfsoftware/effect-cell-types'
import { ErrorText, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
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
import type { RunnerTask, RunnerTestCase, RunnerTestFile, RunnerTestSuite } from 'vitest'

import { interpretVitestDryRun } from './interpret-vitest-dry-run.workflow.js'
import { makeMutantRunCell } from './MutantRun.cell.js'
import { VitestDryRunCommand } from './vitest-run-command.schema.js'
import {
  CoverageDecodeFailed,
  HitCountMetaSchema,
  MutantCoverageMetaSchema,
  MutantCoverageShapeSchema,
  type TestRunnerPhase,
} from './VitestRunner.schema.js'
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
import { VitestSession, type VitestSessionInput } from './VitestSession.service.js'

const asRunnerFailure = (phase: TestRunnerPhase) => <E>(cause: E) =>
  Option.match(Option.liftPredicate(cause, S.is(TestRunner.TestRunnerFailed)), {
    onNone: () =>
      new TestRunner.TestRunnerFailed({
        runnerName: 'vitest',
        phase,
        cause: Option.getOrElse(
          Option.map(ErrorText.ErrorText.fromCause(cause), (rendered) => rendered.text),
          () => '',
        ),
      }),
    onSome: (failed) => failed,
  })

/** The test id parts the sandbox reports: the file it lives in, and its full name. */
const fromTestId = (id: string) => {
  const [file, ...name] = id.split('#')
  return { file, name: name.join('#') }
}

const canonicalOf = (path: string) => Option.getOrElse(S.decodeOption(Mutant.CanonicalFileName)(path), () => path)

const normalizeTestId = (id: string, projectRoot: string, pathService: Path.Path) => {
  const { file, name } = fromTestId(id)
  return canonicalOf(pathService.relative(projectRoot, file)) + '#' + name
}

/** Coverage keyed by project-relative test ids, as the report expects it. */
const normalizeCoverage = (
  rawCoverage: Mutant.MutantCoverage,
  projectRoot: string,
  pathService: Path.Path,
): Mutant.MutantCoverage => ({
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
    })
  )

const messageOfError = (error: { readonly message?: string }): Option.Option<string> =>
  Option.filter(Option.fromNullishOr(error.message), (message) => message.length > 0)

const fileFailureMessages = (file: RunnerTestFile): readonly string[] =>
  Option.match(Option.fromNullishOr(file.result?.errors), {
    onNone: (): readonly string[] => [],
    onSome: (errors) => errors.flatMap((error) => Option.toArray(messageOfError(error))),
  })

const fileFailureMessage = (file: RunnerTestFile): string => {
  const messages = fileFailureMessages(file)
  return messages.length === 0 ? 'StrykerJS: the test file failed to load' : messages.join('\n')
}

const SKIPPED_TEST_MODES: ReadonlySet<string> = new Set(['skip', 'todo'])

const isCollectableTest = (test: RunnerTestCase): boolean =>
  Match.value(test.result !== undefined).pipe(
    Match.when(true, () => true),
    Match.orElse(() => SKIPPED_TEST_MODES.has(test.mode)),
  )

const fileFailedWithoutFailingTest = (
  file: RunnerTestFile,
  tests: readonly RunnerTestCase[],
): boolean =>
  Boolean.match(file.result?.state === 'fail', {
    onTrue: () => !tests.some((test) => test.result?.state === 'fail'),
    onFalse: () => false,
  })

const VITEST_ERROR_CODES = Object.freeze({
  FILES_NOT_FOUND: 'VITEST_FILES_NOT_FOUND',
})

export interface RunFilter {
  testIds?: string[]
  relatedFiles?: string[]
  testFiles?: string[]
}

/** Vitest matches related files against absolute module ids, and only resolves them when the config is first built. */
const relatedFilesOf = <A>(
  relatedValue: A,
  relatedFiles: readonly string[] | undefined,
  projectRoot: string,
  pathService: Path.Path,
) =>
  Boolean.match(relatedValue !== false, {
    onFalse: () => undefined,
    onTrue: () =>
      Option.getOrUndefined(
        Option.map(
          Option.fromNullishOr(relatedFiles),
          (files) => files.map((file) => canonicalOf(pathService.resolve(projectRoot, file))),
        ),
      ),
  })

/** A run limited to specific test ids starts exactly those files under a name pattern. */
const testIdPlan = (
  testIds: readonly string[] | undefined,
  projectRoot: string,
  pathService: Path.Path,
) =>
  Option.map(
    Option.filter(Option.fromNullishOr(testIds), (ids) => ids.length > 0),
    (ids) => ({
      testNamePattern: new RegExp(ids.map((id) => RegExp.escape(fromTestId(id).name)).join('|')),
      testFiles: ids.map((id) => pathService.resolve(projectRoot, fromTestId(id).file)),
    }),
  )

const runFilterPlan = (filter: RunFilter, projectRoot: string, pathService: Path.Path) => {
  const plan = testIdPlan(filter.testIds, projectRoot, pathService)
  return {
    testNamePattern: Option.getOrUndefined(Option.map(plan, (value) => value.testNamePattern)),
    testFiles: Option.match(plan, {
      onNone: () => Option.getOrUndefined(Option.map(Option.fromNullishOr(filter.testFiles), (files) => [...files])),
      onSome: (value) => value.testFiles,
    }),
  }
}

const isMissingTestFilesCause = (cause: string): boolean => cause.includes(VITEST_ERROR_CODES.FILES_NOT_FOUND)

const mergeHitCount = (to: Mutant.CoverageData, mutantId: string, hitCount: number): Mutant.CoverageData => ({
  ...to,
  [mutantId]: Option.getOrElse(Option.fromNullishOr(to[mutantId]), () => 0) + hitCount,
})

const mergeCoverage = (to: Mutant.CoverageData, from: Mutant.CoverageData): Mutant.CoverageData =>
  Object.entries(from).reduce((merged, [mutantId, hitCount]) => mergeHitCount(merged, mutantId, hitCount), to)

/** The TestRunner this package serves: vitest in a sandbox, one session per worker. */
export const layer = (
  input: VitestSessionInput,
): Layer.Layer<TestRunner.TestRunner, never, Crypto.Crypto | FileSystem.FileSystem | Path.Path> =>
  Layer.effect(TestRunner.TestRunner, makeRunner(input)).pipe(Layer.provide(VitestSession.layer(input)))

const makeRunner = Effect.fn('vitest.runner.make')(function*(input: VitestSessionInput) {
  const session = yield* VitestSession
  const pathService = yield* Path.Path
  const projectRoot = input.sandboxDirectory
  const runtime = session.runtime
  const vitestOptions = session.options

  const resetContext = Effect.flatMap(runtime, (self) => Effect.sync(() => clearFiles(self)))

  const readHitCount = Effect.gen(function*() {
    const self = yield* runtime.pipe(Effect.mapError((cause) => new CoverageDecodeFailed({ cause })))
    const hitCounts = yield* Effect.forEach(
      files(self),
      (file) =>
        S.decodeUnknownEffect(HitCountMetaSchema)(metaOf(file)).pipe(
          Effect.mapError((cause) => new CoverageDecodeFailed({ cause })),
          Effect.orElseSucceed(() => ({ hitCount: undefined })),
          Effect.map((decoded) => Option.getOrElse(Option.fromNullishOr(decoded.hitCount), () => 0)),
        ),
    )
    return hitCounts.reduce((total, count) => total + count, 0)
  })

  const validateCoverage = (coverage: Mutant.MutantCoverage) => {
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

  const mergeTestCoverage = (
    perTest: Record<string, Mutant.CoverageData>,
    testId: string,
    coverage: Mutant.CoverageData,
  ): Record<string, Mutant.CoverageData> =>
    Option.match(Option.fromNullishOr(perTest[testId]), {
      onNone: () => ({ ...perTest, [testId]: coverage }),
      onSome: (existing) => ({ ...perTest, [testId]: mergeCoverage(existing, coverage) }),
    })

  const mergeProjectCoverage = (
    into: Mutant.MutantCoverage,
    coverage: Mutant.MutantCoverage,
  ): Mutant.MutantCoverage => ({
    perTest: Object.entries(coverage.perTest).reduce(
      (merged, [testId, perTest]) => mergeTestCoverage(merged, testId, perTest),
      into.perTest,
    ),
    static: mergeCoverage(into.static, coverage.static),
  })

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
      const related = relatedFilesOf(options.related, filter.relatedFiles, projectRoot, pathService)
      const plan = runFilterPlan(filter, projectRoot, pathService)
      yield* applyRunFilter(self, { related, testNamePattern: plan.testNamePattern })
      yield* start(self, plan.testFiles).pipe(
        Effect.catchIf(
          (error: TestRunner.TestRunnerFailed) => isMissingTestFilesCause(error.cause),
          () => Effect.annotateCurrentSpan({ 'stryker.vitest.start_missing_files': true }).pipe(Effect.asVoid),
        ),
        Effect.catchIf(
          (error: TestRunner.TestRunnerFailed) => !isMissingTestFilesCause(error.cause),
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
      const collected = allFiles.map((file) => ({
        file,
        tests: Option.getOrElse(
          Option.map(Option.liftPredicate(file, isRunnerTestSuite), collectTestsFromSuite),
          () => [],
        ).filter(isCollectableTest),
      }))
      const rawTests = collected.flatMap((entry) => entry.tests)
      const fileFailures = collected.flatMap(({ file, tests }) =>
        fileFailedWithoutFailingTest(file, tests)
          ? [{ fileName: file.filepath, message: fileFailureMessage(file) }]
          : []
      )
      const externalError = hasExternalErrors(self)
      yield* Effect.annotateCurrentSpan({
        'stryker.vitest.file_count': allFiles.length,
        'stryker.vitest.raw_test_count': rawTests.length,
        'stryker.vitest.failed_file_count': fileFailures.length,
        'stryker.vitest.has_external_error': externalError,
      })
      return {
        rawTests,
        fileFailures,
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

  const dryRunFilter = (options: TestRunner.DryRunOptions): RunFilter => {
    const relatedFiles = Option.getOrUndefined(
      Option.map(Option.filter(Option.fromNullishOr(options.files), (files) => files.length > 0), (files) => [
        ...files,
      ]),
    )
    return Boolean.match(options.testFiles !== undefined && options.testFiles.length > 0, {
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

  const completeDryRun = (tests: readonly TestRunner.TestResult[]) =>
    Effect.gen(function*() {
      const mutantCoverage = yield* readMutantCoverage.pipe(Effect.mapError(asRunnerFailure('dryRun')))
      yield* Effect.annotateCurrentSpan({
        'stryker.vitest.test_count': tests.length,
        'stryker.vitest.has_mutant_coverage': mutantCoverage !== undefined,
      })
      return Option.match(Option.fromNullishOr(mutantCoverage), {
        onNone: (): TestRunner.DryRunResult => ({ status: 'complete', tests }),
        onSome: (coverage): TestRunner.DryRunResult => ({ status: 'complete', tests, mutantCoverage: coverage }),
      })
    })

  const dryRun = (options: TestRunner.DryRunOptions) =>
    session.setMode('dry-run').pipe(
      Effect.andThen(Effect.gen(function*() {
        const { rawTests, fileFailures, hasExternalError, externalErrorText: errorText } = yield* collectRaw(
          dryRunFilter(options),
        )
        const decision = interpretVitestDryRun(
          yield* S.decodeEffect(VitestDryRunCommand)({
            _tag: 'VitestDryRunCommand',
            projectRoot,
            tests: { projectRoot, records: rawTests, fileFailures },
            hasExternalError,
            externalErrorText: errorText,
          }),
        )
        return yield* Result.match(decision, {
          onFailure: (failure) => Effect.fail(failure),
          onSuccess: (outcome) =>
            Match.value(outcome).pipe(
              Match.tag('Error', (error) =>
                Effect.succeed({ status: 'error' as const, errorMessage: error.errorMessage })),
              Match.tag('Complete', (complete) =>
                completeDryRun(complete.tests)),
              Match.exhaustive,
            ),
        })
      })),
      Effect.mapError(asRunnerFailure('dryRun')),
    )

  const mutantRun = (options: Mutant.MutantRunOptions) =>
    mutantRunCell.run(options).pipe(Effect.mapError(asRunnerFailure('mutantRun')))

  const capabilities = Effect.succeed({ reloadEnvironment: true })
  const initialized = runtime.pipe(Effect.asVoid)

  return TestRunner.TestRunner.of({
    capabilities: initialized.pipe(Effect.andThen(capabilities)),
    init: initialized,
    dryRun: (options) => initialized.pipe(Effect.andThen(dryRun(options))),
    mutantRun: (options) => initialized.pipe(Effect.andThen(mutantRun(options))),
    dispose: session.close,
  })
})
