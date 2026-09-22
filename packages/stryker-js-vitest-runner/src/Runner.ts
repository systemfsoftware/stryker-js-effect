import type * as PathType from 'effect/Path'
import type {
  RunMode,
  RunnerTestCase,
  RunnerTestFile as VitestFile,
  RunnerTestSuite,
  TaskState as VitestTaskState,
} from 'vitest'
import { createVitest as createVitestOriginal } from 'vitest/node'
import type { Vitest } from 'vitest/node'

import { Sandwich } from '@systemfsoftware/effect-cell-types'
import {
  type CoverageData,
  errorToString,
  INSTRUMENTER_CONSTANTS,
  type MutantCoverage as DryRunMutantCoverage,
  type MutantRunOptions,
  normalizeFileName,
} from '@systemfsoftware/stryker-js-instrumenter'
import {
  type BaseTestResult,
  DryRunResult,
  isCustomTestRunner,
  MutantRunResult,
  testFilesProvided,
  type TestResult,
  TestRunner,
  TestRunnerFailed,
  TestStatus,
} from '@systemfsoftware/stryker-js-plugin-interface'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { interpretVitestRun, VitestMutantRunCommand } from './interpret-vitest-run.workflow.js'
import type { VitestMutantRunError, VitestMutantRunOutput } from './interpret-vitest-run.workflow.js'
import {
  CoverageDecodeFailed,
  DryRunComplete,
  DryRunExternalError,
  ExportEntry,
  HitCountMetaSchema,
  MutantCoverageMetaSchema,
  MutantCoverageShapeSchema,
  PackageManifest,
  VitestDryRunCommand,
  type VitestDryRunOutcome,
  VitestRunnerOptionsSchema,
} from './Runner.schema.js'

export class VitestHarness extends Context.Service<VitestHarness, {
  readonly setMode: (mode: 'dry-run' | 'mutant') => Effect.Effect<void, TestRunnerFailed>
  readonly provide: <V = unknown>(
    key: 'hitLimit' | 'mutantActivation' | 'activeMutant',
    value: V,
  ) => Effect.Effect<void, TestRunnerFailed>
}>()('VitestHarness') {}

export function collectTestName({ name, suite }: { name: string; suite?: RunnerTestSuite }): string {
  const nameParts = [name]
  let currentSuite = suite
  while (currentSuite) {
    nameParts.unshift(currentSuite.name)
    currentSuite = currentSuite.suite
  }
  return nameParts.join(' ').trim()
}

export function toRawTestId(test: RunnerTestCase): string {
  return `${test.file.filepath}#${collectTestName(test)}`
}

function convertTaskStateToTestStatus(taskState: VitestTaskState | undefined, testMode: RunMode): TestStatus {
  return Match.value(testMode).pipe(
    Match.when('skip', (): TestStatus => 'skipped'),
    Match.orElse((): TestStatus =>
      Match.value(taskState).pipe(
        Match.when('pass', (): TestStatus => 'success'),
        Match.when('fail', (): TestStatus => 'failed'),
        Match.when('skip', (): TestStatus => 'skipped'),
        Match.when('todo', (): TestStatus => 'skipped'),
        Match.orElse((): TestStatus => 'failed'),
      )
    ),
  )
}

const UNKNOWN_TEST_FAILURE = 'StrykerJS: Unknown test failure'
const SUITE_EXECUTION_FAILED = 'StrykerJS: Suite execution failed'

const firstErrorMessage = (errors: readonly { readonly message?: string }[] | undefined): Option.Option<string> =>
  Option.flatMap(
    Option.fromNullishOr(errors),
    (list) => Option.flatMap(Option.fromNullishOr(list[0]), (error) => Option.fromNullishOr(error.message)),
  )

const taskStateOf = (test: RunnerTestCase): VitestTaskState | undefined =>
  Option.getOrUndefined(
    Option.fromNullishOr(test.result).pipe(Option.flatMap((result) => Option.fromNullishOr(result.state))),
  )

const timeSpentMsOf = (test: RunnerTestCase): number =>
  Option.getOrElse(
    Option.fromNullishOr(test.result).pipe(Option.flatMap((result) => Option.fromNullishOr(result.duration))),
    (): number => 0,
  )

const failureMessageOf = (test: RunnerTestCase): string =>
  Option.getOrElse(
    Option.fromNullishOr(test.result).pipe(Option.flatMap((result) => firstErrorMessage(result.errors))),
    (): string => UNKNOWN_TEST_FAILURE,
  )

const suiteFailureMessageOf = (suite: RunnerTestSuite): string =>
  Option.getOrElse(
    Option.fromNullishOr(suite.result).pipe(Option.flatMap((result) => firstErrorMessage(result.errors))),
    (): string => SUITE_EXECUTION_FAILED,
  )

const isFailedSuite = (suite: RunnerTestSuite): boolean =>
  Option.exists(Option.fromNullishOr(suite.result), (result) => result.state === 'fail')

const findSuiteError = (suite: RunnerTestSuite | undefined): Option.Option<string> =>
  Option.flatMap(Option.fromNullishOr(suite), (node) =>
    Match.value(isFailedSuite(node)).pipe(
      Match.when(true, (): Option.Option<string> => Option.some(suiteFailureMessageOf(node))),
      Match.when(false, (): Option.Option<string> => findSuiteError(node.suite)),
      Match.exhaustive,
    ))

const skippedTestResult = (baseTestResult: BaseTestResult, test: RunnerTestCase): TestResult =>
  Option.match(findSuiteError(test.suite).pipe(Option.filter((message) => message.length > 0)), {
    onNone: (): TestResult => ({ ...baseTestResult, status: 'skipped' }),
    onSome: (failureMessage): TestResult => ({ ...baseTestResult, status: 'failed', failureMessage }),
  })

export function convertTestToTestResult(test: RunnerTestCase, projectRoot: string, pathService: Path.Path): TestResult {
  const baseTestResult: BaseTestResult = {
    id: normalizeTestId(toRawTestId(test), projectRoot, pathService),
    name: collectTestName(test),
    timeSpentMs: timeSpentMsOf(test),
    fileName: pathService.resolve(test.file.filepath),
  }
  return Match.value(convertTaskStateToTestStatus(taskStateOf(test), test.mode)).pipe(
    Match.when('failed', (): TestResult => ({
      ...baseTestResult,
      status: 'failed',
      failureMessage: failureMessageOf(test),
    })),
    Match.when('skipped', (): TestResult => skippedTestResult(baseTestResult, test)),
    Match.orElse((): TestResult => ({ ...baseTestResult, status: 'success' })),
  )
}

export function fromTestId(id: string): { file: string; test: string } {
  const [file, ...name] = id.split('#')
  return { file, test: name.join('#') }
}

export function normalizeTestId(id: string, projectRoot: string, pathService: Path.Path): string {
  const { file, test } = fromTestId(id)
  return `${normalizeFileName(pathService.relative(projectRoot, file))}#${test}`
}

export function normalizeCoverage(
  rawCoverage: DryRunMutantCoverage,
  projectRoot: string,
  pathService: Path.Path,
): DryRunMutantCoverage {
  return {
    perTest: Object.fromEntries(
      Object.entries(rawCoverage.perTest).map((
        [rawTestId, coverageData],
      ) => [normalizeTestId(rawTestId, projectRoot, pathService), coverageData]),
    ),
    static: rawCoverage.static,
  }
}

export function collectTestsFromSuite(suite: RunnerTestSuite): RunnerTestCase[] {
  return suite.tasks.flatMap((task) => {
    if (task.type === 'suite') return collectTestsFromSuite(task satisfies RunnerTestSuite)
    return task satisfies RunnerTestCase
  })
}

export function isErrorCodeError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && typeof Reflect.get(error, 'code') === 'string'
}

export const VITEST_ERROR_CODES = Object.freeze({ FILES_NOT_FOUND: 'VITEST_FILES_NOT_FOUND' })

type TaskState = 'pass' | 'fail' | 'skip' | 'todo' | 'run' | 'queued' | 'only' | undefined

export interface RawVitestRecord<A = unknown> {
  readonly [key: string]: A
}

const isRecordValue = <A = unknown>(value: unknown): value is RawVitestRecord<A> => Predicate.isObject(value)

const recordOption = <A = unknown>(value: A): Option.Option<RawVitestRecord<A>> =>
  isRecordValue<A>(value) ? Option.some(value) : Option.none()

const asString = (value: unknown): value is string => typeof value === 'string'

const asNumber = (value: unknown): value is number => typeof value === 'number'

const asStringOption = <A = unknown>(value: A): Option.Option<string> =>
  asString(value) ? Option.some(value) : Option.none()

const asNumberOption = <A = unknown>(value: A): Option.Option<number> =>
  asNumber(value) ? Option.some(value) : Option.none()

const asArrayOption = <A = unknown>(value: A): Option.Option<readonly A[]> =>
  Array.isArray(value) ? Option.some(value) : Option.none()

const getStringField = <A = unknown>(record: RawVitestRecord<A>, key: string): Option.Option<string> =>
  asStringOption(record[key])

const getNumberField = <A = unknown>(record: RawVitestRecord<A>, key: string): Option.Option<number> =>
  asNumberOption(record[key])

const getSuite = <A = unknown>(value: A): Option.Option<A> =>
  Option.flatMap(recordOption(value), (rec) => Option.fromNullishOr(rec['suite']))

const getFile = <A = unknown>(value: A): Option.Option<A> =>
  Option.flatMap(recordOption(value), (rec) => Option.fromNullishOr(rec['file']))

const getResult = <A = unknown>(value: A): Option.Option<A> =>
  Option.flatMap(recordOption(value), (rec) => Option.fromNullishOr(rec['result']))

const getErrors = <A = unknown>(value: A): Option.Option<readonly A[]> =>
  Option.flatMap(recordOption(value), (rec) => asArrayOption(rec['errors']))

const getMessage = <A = unknown>(value: A): Option.Option<string> =>
  Option.flatMap(recordOption(value), (rec) => getStringField(rec, 'message'))

const getName = <A = unknown>(value: A): string =>
  Option.match(recordOption(value), {
    onNone: () => '',
    onSome: (rec) => Option.getOrElse(getStringField(rec, 'name'), () => ''),
  })

const getMode = <A = unknown>(value: A): string =>
  Option.match(recordOption(value), {
    onNone: () => 'run',
    onSome: (rec) => Option.getOrElse(getStringField(rec, 'mode'), () => 'run'),
  })

const TASK_STATES: Readonly<Record<string, TaskState>> = Object.freeze({
  pass: 'pass',
  fail: 'fail',
  skip: 'skip',
  todo: 'todo',
  run: 'run',
  queued: 'queued',
  only: 'only',
})

const getState = <A = unknown>(value: A): TaskState =>
  Option.match(asStringOption(value), {
    onNone: (): TaskState => undefined,
    onSome: (state): TaskState => TASK_STATES[state],
  })

const getDuration = <A = unknown>(value: A): number =>
  Option.match(recordOption(value), {
    onNone: () => 0,
    onSome: (rec) => Option.getOrElse(getNumberField(rec, 'duration'), () => 0),
  })

const getFilepath = <A = unknown>(value: A): string | undefined =>
  Option.match(recordOption(value), {
    onNone: (): string | undefined => undefined,
    onSome: (rec): string | undefined => Option.getOrUndefined(getStringField(rec, 'filepath')),
  })

const collectSuiteNames = <A = unknown>(suite: A): readonly string[] =>
  Option.match(Option.fromNullishOr(suite), {
    onNone: (): readonly string[] => [],
    onSome: (current): readonly string[] =>
      Option.match(recordOption(current), {
        onNone: (): readonly string[] => [],
        onSome: (rec): readonly string[] => {
          const name = Option.getOrElse(getStringField(rec, 'name'), () => '')
          const hasName = name.length > 0
          const parentNames = collectSuiteNames(rec['suite'])
          return Match.value(hasName).pipe(
            Match.when(true, (): readonly string[] => [...parentNames, name]),
            Match.when(false, (): readonly string[] => parentNames),
            Match.exhaustive,
          )
        },
      }),
  })

const collectTestNameRaw = <A = unknown>(test: A): string => {
  const name = getName(test)
  const suite = Option.getOrUndefined(getSuite(test))
  const suiteNames = collectSuiteNames(suite)
  const parts = [...suiteNames, name]
  return parts.join(' ').trim()
}

const toRawTestIdRaw = <A = unknown>(test: A): string => {
  const filepath = Option.match(getFile(test), {
    onNone: (): string => 'unknown.js',
    onSome: (file): string => Option.getOrElse(Option.fromNullishOr(getFilepath(file)), (): string => 'unknown.js'),
  })
  return `${filepath}#${collectTestNameRaw(test)}`
}

const normalizeTestIdRaw = (id: string, projectRoot: string): string => {
  const hash = id.indexOf('#')
  if (hash === -1) {
    return id
  }
  const file = id.slice(0, hash)
  const rest = id.slice(hash + 1)
  const stripped = (() => {
    if (file.startsWith(projectRoot)) {
      return file.slice(projectRoot.length)
    }
    return file
  })()
  const relative = stripped.replace(/^[/\\]+/, '').replaceAll('\\', '/')
  return `${relative}#${rest}`
}

const toTestStatus = (taskState: TaskState, mode: string): TestStatus =>
  Match.value(mode === 'skip').pipe(
    Match.when(true, (): TestStatus => 'skipped'),
    Match.when(false, (): TestStatus =>
      Match.value(taskState).pipe(
        Match.when('pass', (): TestStatus => 'success'),
        Match.when('skip', (): TestStatus => 'skipped'),
        Match.when('todo', (): TestStatus => 'skipped'),
        Match.orElse((): TestStatus => 'failed'),
      )),
    Match.exhaustive,
  )

const findSuiteErrorRaw = <A = unknown>(suite: A): string | undefined =>
  Option.match(Option.fromNullishOr(suite), {
    onNone: (): string | undefined => undefined,
    onSome: (current): string | undefined =>
      Option.match(recordOption(current), {
        onNone: (): string | undefined => undefined,
        onSome: (rec): string | undefined => {
          const maybeError = Option.flatMap(getResult(rec), (result) =>
            Option.flatMap(getErrors(result), (errs) =>
              Match.value(errs.length > 0).pipe(
                Match.when(true, () => Option.flatMap(Option.fromNullishOr(errs[0]), (first) => getMessage(first))),
                Match.when(false, () => Option.none()),
                Match.exhaustive,
              )))
          return Option.match(maybeError, {
            onNone: (): string | undefined =>
              findSuiteErrorRaw(rec['suite']),
            onSome: (msg): string | undefined => msg,
          })
        },
      }),
  })

const extractStatus = <A = unknown>(test: A): TestStatus => {
  const result = Option.getOrUndefined(getResult(test))
  const mode = getMode(test)
  const state = Option.match(Option.fromNullishOr(result), {
    onNone: (): TaskState => undefined,
    onSome: (r): TaskState =>
      Option.match(recordOption(r), {
        onNone: (): TaskState => undefined,
        onSome: (rec): TaskState => getState(rec['state']),
      }),
  })
  return toTestStatus(state, mode)
}

const extractDuration = <A = unknown>(test: A): number =>
  Option.match(getResult(test), {
    onNone: (): number => 0,
    onSome: (result): number =>
      Option.match(recordOption(result), {
        onNone: (): number => 0,
        onSome: (rec): number => getDuration(rec),
      }),
  })

const extractFileName = <A = unknown>(test: A): string | undefined =>
  Option.match(getFile(test), {
    onNone: (): string | undefined => undefined,
    onSome: (file): string | undefined => getFilepath(file),
  })

const extractRawId = <A = unknown>(test: A, projectRoot: string): string =>
  normalizeTestIdRaw(toRawTestIdRaw(test), projectRoot)

const extractName = <A = unknown>(test: A): string => collectTestNameRaw(test)

const extractFailureMessage = <A = unknown>(test: A): string =>
  Option.match(getResult(test), {
    onNone: (): string => 'StrykerJS: Unknown test failure',
    onSome: (result): string =>
      Option.match(getErrors(result), {
        onNone: (): string => 'StrykerJS: Unknown test failure',
        onSome: (errs): string =>
          Match.value(errs.length > 0).pipe(
            Match.when(true, (): string =>
              Option.match(Option.fromNullishOr(errs[0]), {
                onNone: (): string => 'StrykerJS: Unknown test failure',
                onSome: (first): string =>
                  Option.getOrElse(getMessage(first), (): string => 'StrykerJS: Unknown test failure'),
              })),
            Match.when(false, (): string => 'StrykerJS: Unknown test failure'),
            Match.exhaustive,
          ),
      }),
  })

const convertTestRaw = <A = unknown>(
  test: A,
  projectRoot: string,
): {
  readonly id: string
  readonly name: string
  readonly timeSpentMs: number
  readonly fileName: string | undefined
  readonly status: TestStatus
  readonly failureMessage?: string
} => {
  const status = extractStatus(test)
  const base = {
    id: extractRawId(test, projectRoot),
    name: extractName(test),
    timeSpentMs: extractDuration(test),
    fileName: extractFileName(test),
    status,
  }
  return Match.value(status).pipe(
    Match.when('failed', (): {
      readonly id: string
      readonly name: string
      readonly timeSpentMs: number
      readonly fileName: string | undefined
      readonly status: TestStatus
      readonly failureMessage?: string
    } => ({ ...base, status, failureMessage: extractFailureMessage(test) })),
    Match.when('skipped', (): {
      readonly id: string
      readonly name: string
      readonly timeSpentMs: number
      readonly fileName: string | undefined
      readonly status: TestStatus
      readonly failureMessage?: string
    } =>
      Match.value(findSuiteErrorRaw(Option.getOrUndefined(getSuite(test)))).pipe(
        Match.when(Match.defined, (suiteError): {
          readonly id: string
          readonly name: string
          readonly timeSpentMs: number
          readonly fileName: string | undefined
          readonly status: TestStatus
          readonly failureMessage?: string
        } => ({
          ...base,
          status: 'failed',
          failureMessage: suiteError,
        })),
        Match.orElse((): {
          readonly id: string
          readonly name: string
          readonly timeSpentMs: number
          readonly fileName: string | undefined
          readonly status: TestStatus
          readonly failureMessage?: string
        } => ({ ...base, status })),
      )),
    Match.orElse((): {
      readonly id: string
      readonly name: string
      readonly timeSpentMs: number
      readonly fileName: string | undefined
      readonly status: TestStatus
      readonly failureMessage?: string
    } => ({ ...base, status })),
  )
}

export const decideVitestDryRun = (command: VitestDryRunCommand): VitestDryRunOutcome => {
  const tests = command.rawTests.map((t) => convertTestRaw(t, command.projectRoot))
  const testsJson = JSON.stringify(tests)
  const hasFailure = tests.some((t) => t.status === 'failed')
  return Match.value(hasFailure).pipe(
    Match.when(true, (): VitestDryRunOutcome => DryRunComplete.make({ testsJson })),
    Match.orElse((): VitestDryRunOutcome =>
      Match.value(command.hasExternalError).pipe(
        Match.when(
          true,
          (): VitestDryRunOutcome =>
            DryRunExternalError.make({
              testsJson,
              errorMessage: `An error occurred outside of a test run: ${command.externalErrorText}`,
            }),
        ),
        Match.orElse((): VitestDryRunOutcome => DryRunComplete.make({ testsJson })),
      )
    ),
  )
}

const TYPESCRIPT_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts'] as const

const isTypescriptSourcePath = (filePath: string): boolean =>
  TYPESCRIPT_SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension))

const typescriptSourcePath = (filePath: string): string | undefined =>
  Option.getOrUndefined(Option.filter(Option.some(filePath), isTypescriptSourcePath))

const sourceTargetOf = (entry: ExportEntry): string | undefined =>
  Match.value(entry).pipe(
    Match.when(Match.string, (filePath) => typescriptSourcePath(filePath)),
    Match.orElse((): string | undefined => undefined),
  )

const subpathSpecifier = (packageName: string, exportKey: string): string | undefined =>
  Match.value(exportKey.startsWith('./')).pipe(
    Match.when(true, () => `${packageName}/${exportKey.slice(2)}`),
    Match.orElse((): string | undefined => undefined),
  )

const specifierForExport = (packageName: string, exportKey: string): string | undefined =>
  Match.value(exportKey).pipe(
    Match.when('.', () => packageName),
    Match.when('./package.json', () => undefined),
    Match.orElse((key) => subpathSpecifier(packageName, key)),
  )

const namedExports = (
  manifest: PackageManifest,
): Option.Option<{ readonly name: string; readonly exports: Record<string, ExportEntry> }> =>
  Option.flatMap(
    Option.filter(Option.fromNullishOr(manifest.name), (name) => name.length > 0),
    (name) => Option.map(Option.fromNullishOr(manifest.exports), (exportMap) => ({ name, exports: exportMap })),
  )

const exportAlias = (
  packageName: string,
  projectRoot: string,
  pathService: PathType.Path,
  [exportKey, entry]: readonly [string, ExportEntry],
): Option.Option<SandboxAlias> =>
  Option.flatMap(
    Option.fromNullishOr(specifierForExport(packageName, exportKey)),
    (spec) =>
      Option.map(Option.fromNullishOr(sourceTargetOf(entry)), (target) => ({
        find: new RegExp(`^${RegExp.escape(spec)}$`),
        replacement: pathService.resolve(projectRoot, target),
      })),
  )

export const sandboxSelfAliases = (
  manifest: PackageManifest,
  projectRoot: string,
  pathService: PathType.Path,
): readonly SandboxAlias[] =>
  Option.match(namedExports(manifest), {
    onNone: (): readonly SandboxAlias[] => [],
    onSome: ({ name, exports: exportMap }) =>
      Object.entries(exportMap).flatMap((entry) => Option.toArray(exportAlias(name, projectRoot, pathService, entry))),
  })

export interface SandboxAlias {
  readonly find: RegExp
  readonly replacement: string
}

const parseJsonRecord = (text: string): Option.Option<RawVitestRecord> => {
  try {
    return recordOption(JSON.parse(text))
  } catch {
    return Option.none()
  }
}

const parseJson = (text: string): RawVitestRecord | undefined => Option.getOrUndefined(parseJsonRecord(text))
export const readSandboxSelfAliases = (
  projectRoot: string,
): Effect.Effect<readonly SandboxAlias[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const raw = yield* fs.readFileString(pathService.join(projectRoot, 'package.json')).pipe(
      Effect.orElseSucceed(() => null satisfies string | null),
    )
    return Option.match(
      Option.flatMap(
        Option.fromNullishOr(raw),
        (content) => S.decodeUnknownOption(PackageManifest)(parseJson(content)),
      ),
      {
        onNone: () => [] satisfies readonly SandboxAlias[],
        onSome: (manifest) => sandboxSelfAliases(manifest, projectRoot, pathService),
      },
    )
  })

export const sandboxSelfPlugin = (
  aliases: readonly SandboxAlias[],
): { readonly name: string; readonly enforce: 'pre'; readonly resolveId: (source: string) => string | undefined } => ({
  name: 'stryker-sandbox-self-exports',
  enforce: 'pre',
  resolveId(source: string): string | undefined {
    return Option.getOrUndefined(
      Option.map(
        Option.fromNullishOr(aliases.find((alias) => alias.find.test(source))),
        (alias) => alias.replacement,
      ),
    )
  },
})

export interface ResolvedVitest {
  createVitest: typeof createVitestOriginal
}
export type VitestResolver = (
  _dir: string,
) => Effect.Effect<ResolvedVitest, never, FileSystem.FileSystem | Path.Path>

const isRunnerTestSuite = (value: unknown): value is RunnerTestSuite =>
  Predicate.isObject(value) && Array.isArray(value['tasks'])

type StrykerNamespace = '__stryker__' | '__stryker2__'
const STRYKER_SETUP_URL = new URL('./stryker-setup.mjs', import.meta.url)

const VITEST_NODE_SPECIFIER = 'vitest/node'

const vitestUnresolved = (specifier: string, base: string, detail: string): TestRunnerFailed =>
  new TestRunnerFailed({
    runnerName: 'vitest',
    phase: 'init',
    cause: `Cannot resolve "${specifier}" from "${base}": ${detail}`,
  })

const hasCreateVitest = (
  value: object,
): value is { readonly createVitest: ResolvedVitest['createVitest'] } =>
  Predicate.hasProperty(value, 'createVitest') && Predicate.isFunction(value['createVitest'])

const isVitestNodeModule = (
  value: unknown,
): value is { readonly createVitest: ResolvedVitest['createVitest'] } => {
  if (!Predicate.isObject(value)) {
    return false
  }
  return hasCreateVitest(value)
}

export const resolveVitest: VitestResolver = (_dir) => {
  const fallback = Effect.succeed({ createVitest: createVitestOriginal } satisfies ResolvedVitest)
  const primary = Effect.gen(function*() {
    const resolutionFailure = (specifier: string, detail: string): TestRunnerFailed =>
      vitestUnresolved(specifier, import.meta.url, detail)
    const resolveSpecifier = (specifier: string): Effect.Effect<string, TestRunnerFailed> =>
      Effect.try({
        try: (): string => import.meta.resolve(specifier),
        catch: (cause) => resolutionFailure(specifier, errorToString(cause)),
      })
    const vitestNodeUrl = yield* resolveSpecifier(VITEST_NODE_SPECIFIER)
    const imported: RawVitestRecord = yield* Effect.tryPromise({
      try: (): Promise<RawVitestRecord> => import(vitestNodeUrl),
      catch: (cause) => resolutionFailure(VITEST_NODE_SPECIFIER, errorToString(cause)),
    })
    if (!isVitestNodeModule(imported)) {
      return yield* resolutionFailure(VITEST_NODE_SPECIFIER, 'Missing createVitest export on vitest/node module')
    }
    return { createVitest: imported.createVitest } satisfies ResolvedVitest
  })
  return primary.pipe(Effect.catchCause(() => fallback), Effect.catchDefect(() => fallback), Effect.orDie)
}

interface RunFilter {
  testIds?: string[]
  relatedFiles?: string[]
  testFiles?: string[]
}

type RunFilterPlan = {
  readonly testNamePattern: RegExp | undefined
  readonly testFiles: string[] | undefined
}

const relatedFilesOf = <A = unknown>(
  relatedValue: A,
  relatedFiles: readonly string[] | undefined,
): string[] | undefined =>
  Match.value(relatedValue !== false).pipe(
    Match.when(
      true,
      () =>
        Option.getOrUndefined(Option.map(Option.fromNullishOr(relatedFiles), (files) => files.map(normalizeFileName))),
    ),
    Match.orElse((): string[] | undefined => undefined),
  )

const testIdPlan = (
  testIds: readonly string[] | undefined,
  projectRoot: string,
  pathService: Path.Path,
): Option.Option<RunFilterPlan> =>
  Option.map(Option.filter(Option.fromNullishOr(testIds), (ids) => ids.length > 0), (ids) => ({
    testNamePattern: new RegExp(ids.map((id) => RegExp.escape(fromTestId(id).test)).join('|')),
    testFiles: ids.map((id) => pathService.resolve(projectRoot, fromTestId(id).file)),
  }))

const runFilterPlan = (filter: RunFilter, projectRoot: string, pathService: Path.Path): RunFilterPlan => {
  const plan = testIdPlan(filter.testIds, projectRoot, pathService)
  return {
    testNamePattern: Option.getOrUndefined(Option.map(plan, (value) => value.testNamePattern)),
    testFiles: Option.match(plan, {
      onNone: (): string[] | undefined =>
        Option.getOrUndefined(Option.map(Option.fromNullishOr(filter.testFiles), (files) => [...files])),
      onSome: (value): string[] | undefined => value.testFiles,
    }),
  }
}

const isMissingTestFilesCause = <A = unknown>(cause: A): boolean =>
  Match.value(isErrorCodeError(cause)).pipe(
    Match.when(true, () => typeof cause === 'string' && cause.includes(VITEST_ERROR_CODES.FILES_NOT_FOUND)),
    Match.orElse((): boolean => false),
  )
interface RunnerState {
  ctx: Vitest | undefined
  localSetupFile: string | undefined
}

const experimentalStateGetFiles = (vitest: Vitest): readonly VitestFile[] => vitest.state.getFiles()

const isOpaqueRecord = <A = unknown, V = unknown>(value: A): value is A & Record<string, V> => Predicate.isObject(value)

const propertyOf = <A = unknown, V = unknown>(value: A, key: string): Option.Option<V> => {
  if (!isOpaqueRecord<A, V>(value)) {
    return Option.none()
  }
  return Option.fromNullishOr(value[key])
}

const vitestStateOf = <A = unknown>(vitest: A): Option.Option<A> => propertyOf(vitest, 'state')

const errorsSetOf = <A = unknown>(vitest: A): Option.Option<A> =>
  Option.flatMap(vitestStateOf(vitest), (state) => propertyOf(state, 'errorsSet'))

const invokeMethod = <A = unknown>(holder: A, name: string): void =>
  Option.match(Option.filter(propertyOf(holder, name), Predicate.isFunction), {
    onNone: (): void => undefined,
    onSome: (method): void => {
      Reflect.apply(method, holder, [])
    },
  })

const clearFilesMap = <A = unknown>(filesMap: A): void =>
  Match.value(filesMap).pipe(
    Match.when(Match.instanceOf(Map), (map) => {
      map.clear()
    }),
    Match.orElse((value): void => invokeMethod(value, 'clear')),
  )

const experimentalStateClearFiles = <A = unknown>(vitest: A): void =>
  Option.match(Option.flatMap(vitestStateOf(vitest), (state) => propertyOf(state, 'filesMap')), {
    onNone: (): void => undefined,
    onSome: (filesMap): void => clearFilesMap(filesMap),
  })

const entryCountOf = <A = unknown>(collection: A): Option.Option<number> =>
  Match.value(collection).pipe(
    Match.when(Match.instanceOf(Set), (set) => Option.some(set.size)),
    Match.orElse((value) => Option.filter(propertyOf(value, 'size'), Predicate.isNumber)),
  )

const experimentalStateHasExternalErrors = <A = unknown>(vitest: A): boolean =>
  Option.exists(Option.flatMap(errorsSetOf(vitest), entryCountOf), (count) => count > 0)

const experimentalStateGetExternalErrorText = <A = unknown>(vitest: A): string =>
  Option.match(errorsSetOf(vitest), {
    onNone: (): string => '',
    onSome: (errorsSet): string => Predicate.isIterable(errorsSet) ? [...errorsSet].map(errorToString).join('\n') : '',
  })

const isMutantActivation = (value: unknown): value is 'runtime' | 'static' => value === 'runtime' || value === 'static'

const applyMutantActivation = <A = unknown>(ctx: Vitest, value: A): void => {
  if (isMutantActivation(value)) ctx.provide('mutantActivation', value)
}

const applyActiveMutant = <A = unknown>(ctx: Vitest, value: A): void => {
  if (Predicate.isString(value)) ctx.provide('activeMutant', value)
}

const applyHarnessValue = <A = unknown>(
  ctx: Vitest,
  key: 'hitLimit' | 'mutantActivation' | 'activeMutant',
  value: A,
): void =>
  Match.value(key).pipe(
    Match.when('hitLimit', () => {
      ctx.provide('hitLimit', Option.getOrUndefined(Option.filter(Option.fromNullishOr(value), Predicate.isNumber)))
    }),
    Match.when('mutantActivation', () => {
      applyMutantActivation(ctx, value)
    }),
    Match.orElse(() => {
      applyActiveMutant(ctx, value)
    }),
  )

const applyRunFilterToConfig = (
  vitest: Vitest,
  options: { related: string[] | undefined; testNamePattern: RegExp | undefined },
): Effect.Effect<void> =>
  Effect.sync(() => {
    vitest.config.related = options.related
    for (const project of vitest.projects) {
      project.config.testNamePattern = options.testNamePattern
    }
  })

const disableScreenshotFailures = <A = unknown>(value: A): void =>
  Option.match(Option.filter(Option.fromNullishOr(value), Predicate.isObject), {
    onNone: (): void => undefined,
    onSome: (browser): void => {
      Reflect.set(browser, 'screenshotFailures', false)
    },
  })

const setupFilePathsOf = <A = unknown>(value: A): readonly string[] => {
  if (Array.isArray(value)) {
    return value.filter((v: unknown): v is string => typeof v === 'string')
  }
  return []
}

const applySetupFilesToProjects = (vitest: Vitest, localSetupFile: string): void => {
  disableScreenshotFailures(Reflect.get(vitest.config, 'browser'))
  for (const project of vitest.projects) {
    const setupFiles = setupFilePathsOf(Reflect.get(project.config, 'setupFiles'))
    Reflect.set(project.config, 'setupFiles', [localSetupFile, ...setupFiles])
    disableScreenshotFailures(Reflect.get(project.config, 'browser'))
  }
}
const trapIdMatches = (mutantId: string, trapId: string | undefined): boolean => {
  if (trapId === undefined) {
    return false
  }
  return trapId === mutantId
}

const trapFilePresent = (trapFile: string | undefined): trapFile is string => {
  if (trapFile === undefined) {
    return false
  }
  return trapFile.length > 0
}

const fileEndsWithTrap = (fileName: string, needle: string): boolean => {
  if (fileName === needle) {
    return true
  }
  return fileName.endsWith(`/${needle}`)
}

const trapFileMatches = (fileName: string, trapFile: string | undefined): boolean => {
  if (!trapFilePresent(trapFile)) {
    return false
  }
  const normalizedFile = fileName.replaceAll('\\', '/')
  const needle = trapFile.replaceAll('\\', '/')
  return fileEndsWithTrap(normalizedFile, needle)
}

const idFromTrapId = (mutantId: string, trapId: string | undefined): string | undefined => {
  if (!trapIdMatches(mutantId, trapId)) {
    return undefined
  }
  return mutantId
}

const idFromTrapFile = (
  mutant: { readonly id: string; readonly fileName: string },
  trapFile: string | undefined,
): string | undefined => {
  if (!trapFileMatches(mutant.fileName, trapFile)) {
    return undefined
  }
  return mutant.id
}

const namedTrapIdOf = (
  mutant: { readonly id: string; readonly fileName: string },
  options: { readonly timeoutTrapFile?: string | undefined; readonly timeoutTrapMutantId?: string | undefined },
): string | undefined =>
  idFromTrapId(mutant.id, options.timeoutTrapMutantId) ?? idFromTrapFile(mutant, options.timeoutTrapFile)

export interface VitestRunnerLayerInput {
  readonly options: StrykerOptions
  readonly sandboxDirectory: string
  readonly globalNamespace?: StrykerNamespace
  readonly resolveVitestFor?: VitestResolver
  readonly setupFilePath?: string
}

export const makeVitestRunnerLayer = (
  input: VitestRunnerLayerInput,
): Layer.Layer<TestRunner, never, Crypto.Crypto | FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    TestRunner,
    Effect.gen(function*() {
      const stateRef = yield* Ref.make<RunnerState>({ ctx: undefined, localSetupFile: undefined })
      const cryptoService = yield* Crypto.Crypto
      const fsService = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const getState = Ref.get(stateRef)
      const requireCtx = Effect.gen(function*() {
        const state = yield* getState
        if (state.ctx === undefined) {
          return yield* new TestRunnerFailed({
            runnerName: 'vitest',
            phase: 'dryRun',
            cause: errorToString(new Error('Vitest runner is not initialized; call init() before running tests')),
          })
        }
        return state.ctx
      })
      const vitestOptionsEffect = S.decodeEffect(VitestRunnerOptionsSchema)(
        Match.value(input.options.testRunner).pipe(
          Match.when(isCustomTestRunner, (runner) =>
            Match.value(runner.options).pipe(
              Match.when(Match.undefined, () => ({})),
              Match.orElse((opts) => opts),
            )),
          Match.orElse(() => ({})),
        ),
      ).pipe(
        Effect.mapError((cause) =>
          new TestRunnerFailed({ runnerName: 'vitest', phase: 'init', cause: errorToString(cause) })
        ),
      )

      const capabilities: TestRunner['Service']['capabilities'] = Effect.succeed({ reloadEnvironment: true })
      const init: TestRunner['Service']['init'] = Effect.gen(function*() {
        const vitestOptions = yield* vitestOptionsEffect
        const projectRoot = input.sandboxDirectory
        const setupFileSuffix = yield* cryptoService.randomUUIDv4.pipe(
          Effect.mapError((cause) =>
            new TestRunnerFailed({ runnerName: 'vitest', phase: 'init', cause: errorToString(cause) })
          ),
        )
        const localSetupFile = pathService.resolve(projectRoot, `stryker-setup-${setupFileSuffix}.js`)
        yield* Ref.update(stateRef, (s) => ({ ...s, localSetupFile }))
        const defaultSetupPath = yield* pathService.fromFileUrl(STRYKER_SETUP_URL).pipe(
          Effect.mapError((cause) =>
            new TestRunnerFailed({ runnerName: 'vitest', phase: 'init', cause: errorToString(cause) })
          ),
        )
        const setupFilePath = Option.getOrElse(Option.fromNullishOr(input.setupFilePath), () => defaultSetupPath)
        yield* fsService.copyFile(setupFilePath, localSetupFile).pipe(
          Effect.mapError((cause) =>
            new TestRunnerFailed({ runnerName: 'vitest', phase: 'init', cause: errorToString(cause) })
          ),
        )
        const resolver = Option.getOrElse(Option.fromNullishOr(input.resolveVitestFor), () => resolveVitest)
        const { createVitest } = yield* resolver(projectRoot).pipe(
          Effect.provideService(FileSystem.FileSystem, fsService),
          Effect.provideService(Path.Path, pathService),
          Effect.catchDefect((cause) =>
            Effect.fail(new TestRunnerFailed({ runnerName: 'vitest', phase: 'init', cause: errorToString(cause) }))
          ),
        )
        const namespace = Option.getOrElse(
          Option.fromNullishOr(input.globalNamespace),
          () => INSTRUMENTER_CONSTANTS.NAMESPACE,
        )
        const scanDir = (() => {
          if (typeof vitestOptions.dir === 'string') return pathService.resolve(projectRoot, vitestOptions.dir)
          return undefined
        })()
        const aliases = yield* readSandboxSelfAliases(projectRoot).pipe(
          Effect.provideService(FileSystem.FileSystem, fsService),
          Effect.provideService(Path.Path, pathService),
        )
        const plugin = sandboxSelfPlugin(aliases)
        const ctx = yield* Effect.tryPromise({
          try: () =>
            createVitest('test', {
              config: vitestOptions.configFile,
              coverage: { enabled: false },
              maxWorkers: 1,
              maxConcurrency: 1,
              watch: false,
              root: projectRoot,
              ...((() => {
                if (scanDir === undefined) return {}
                return { dir: scanDir }
              })()),
              bail: (() => {
                if (input.options.disableBail) return 0
                return 1
              })(),
              onConsoleLog: () => false,
              silent: true,
              reporters: [{ onInit(_vitest: Vitest) {} }],
            }, {
              resolve: { alias: [...aliases], conditions: ['import'] },
              plugins: [plugin],
            }),
          catch: (cause) => new TestRunnerFailed({ runnerName: 'vitest', phase: 'init', cause: errorToString(cause) }),
        })
        ctx.provide('globalNamespace', namespace)
        applySetupFilesToProjects(ctx, localSetupFile)
        yield* Ref.update(stateRef, (s) => ({ ...s, ctx }))
      }).pipe(Effect.mapError((cause) => ((() => {
        if (S.is(TestRunnerFailed)(cause)) return cause
        return new TestRunnerFailed({ runnerName: 'vitest', phase: 'init', cause: errorToString(cause) })
      })())))
      const resetContext = Effect.gen(function*() {
        const ctx = yield* requireCtx
        experimentalStateClearFiles(ctx)
      })
      const getFileMeta = <A = unknown, M = unknown>(file: A): M | undefined =>
        Option.getOrUndefined(propertyOf<A, M>(file, 'meta'))
      const readHitCount: Effect.Effect<number, CoverageDecodeFailed> = Effect.gen(function*() {
        const ctx = yield* requireCtx.pipe(Effect.mapError((cause) => new CoverageDecodeFailed({ cause })))
        const hitCounts = yield* Effect.forEach(
          experimentalStateGetFiles(ctx),
          (file) =>
            Effect.map(
              S.decodeUnknownEffect(HitCountMetaSchema)(getFileMeta(file)).pipe(
                Effect.mapError((cause) => new CoverageDecodeFailed({ cause })),
                Effect.orElseSucceed(() => ({ hitCount: undefined })),
              ),
              (decoded) => Option.getOrElse(Option.fromNullishOr(decoded.hitCount), () => 0),
            ),
        )
        return hitCounts.reduce((total, count) => total + count, 0)
      })
      const stringProperty = <A = unknown>(value: A, key: string): string =>
        Option.getOrElse(Option.filter(propertyOf(value, key), Predicate.isString), () => '')

      const dedupeFilesByName = <A = unknown>(files: readonly A[]): Record<string, A> =>
        Object.fromEntries(
          files.map((file) => [`${stringProperty(file, 'projectName')}-${stringProperty(file, 'name')}`, file]),
        )

      const validateCoverage = (
        mutantCoverage: DryRunMutantCoverage,
      ): Effect.Effect<DryRunMutantCoverage, CoverageDecodeFailed> => {
        const normalized = normalizeCoverage(mutantCoverage, input.sandboxDirectory, pathService)
        return S.decodeEffect(MutantCoverageShapeSchema)(normalized).pipe(
          Effect.mapError((cause) => new CoverageDecodeFailed({ cause })),
          Effect.map(() => normalized),
        )
      }

      const coverageOfFile = <A = unknown>(
        file: A,
      ): Effect.Effect<DryRunMutantCoverage | undefined, CoverageDecodeFailed> =>
        Effect.gen(function*() {
          const decoded = yield* S.decodeUnknownEffect(MutantCoverageMetaSchema)(getFileMeta(file)).pipe(
            Effect.mapError((cause) => new CoverageDecodeFailed({ cause })),
            Effect.orElseSucceed(() => ({ mutantCoverage: undefined })),
          )
          const mutantCoverage = Option.fromNullishOr(decoded.mutantCoverage)
          if (Option.isNone(mutantCoverage)) {
            return undefined
          }
          return yield* validateCoverage(mutantCoverage.value)
        })

      const mergeTestCoverage = (
        perTest: Record<string, CoverageData>,
        testId: string,
        coverage: CoverageData,
      ): void =>
        Option.match(Option.fromNullishOr(perTest[testId]), {
          onNone: (): void => {
            perTest[testId] = coverage
          },
          onSome: (existing): void => {
            mergeCoverage(existing, coverage)
          },
        })

      const mergeProjectCoverage = (
        acc: DryRunMutantCoverage,
        projectCoverage: DryRunMutantCoverage,
      ): DryRunMutantCoverage => {
        for (const [testId, testCoverage] of Object.entries(projectCoverage.perTest)) {
          mergeTestCoverage(acc.perTest, testId, testCoverage)
        }
        mergeCoverage(acc.static, projectCoverage.static)
        return acc
      }

      const readMutantCoverage: Effect.Effect<DryRunMutantCoverage | undefined, CoverageDecodeFailed> = Effect.gen(
        function*() {
          const ctx = yield* requireCtx.pipe(Effect.mapError((cause) => new CoverageDecodeFailed({ cause })))
          const files = Object.values(dedupeFilesByName(experimentalStateGetFiles(ctx)))
          const coverages = (yield* Effect.forEach(files, coverageOfFile)).filter(Predicate.isNotNullish)
          return Option.getOrUndefined(
            Option.map(Option.fromNullishOr(coverages[0]), (first) =>
              coverages.slice(1).reduce(mergeProjectCoverage, first)),
          )
        },
      )
      const collectRaw = (
        filter: RunFilter,
      ): Effect.Effect<
        { rawTests: readonly RunnerTestCase[]; hasExternalError: boolean; externalErrorText: string },
        TestRunnerFailed
      > =>
        Effect.gen(function*() {
          const ctx = yield* requireCtx
          const vitestOptions = yield* vitestOptionsEffect
          yield* resetContext.pipe(
            Effect.mapError((cause) =>
              new TestRunnerFailed({ runnerName: 'vitest', phase: 'dryRun', cause: errorToString(cause) })
            ),
          )
          const related = relatedFilesOf(vitestOptions.related, filter.relatedFiles)
          const plan = runFilterPlan(filter, input.sandboxDirectory, pathService)
          yield* applyRunFilterToConfig(ctx, { related, testNamePattern: plan.testNamePattern })
          yield* Effect.tryPromise({
            try: () =>
              ctx.start(plan.testFiles),
            catch: (cause) =>
              new TestRunnerFailed({ runnerName: 'vitest', phase: 'dryRun', cause: errorToString(cause) }),
          }).pipe(
            Effect.catchIf((error: TestRunnerFailed) => isMissingTestFilesCause(error.cause), () => Effect.void),
          )
          const allFiles = experimentalStateGetFiles(ctx)
          const rawTests = allFiles.flatMap((
            file,
          ) => ((() => {
            if (isRunnerTestSuite(file)) return collectTestsFromSuite(file)
            return []
          })())).filter((test) => test.result !== undefined)
          const hasExternalError = experimentalStateHasExternalErrors(ctx)
          const externalErrorText = Match.value(hasExternalError).pipe(
            Match.when(true, () => experimentalStateGetExternalErrorText(ctx)),
            Match.orElse((): string => ''),
          )
          return { rawTests, hasExternalError, externalErrorText }
        })

      const harnessImpl: VitestHarness['Service'] = {
        setMode: (mode) => Effect.flatMap(requireCtx, (ctx) => Effect.sync(() => ctx.provide('mode', mode))),
        provide: (key, value) =>
          Effect.flatMap(requireCtx, (ctx) => Effect.sync(() => applyHarnessValue(ctx, key, value))),
      }

      const mutantRunCell = Sandwich.read((command: MutantRunOptions) =>
        Effect.gen(function*() {
          const harness = yield* VitestHarness
          yield* harness.setMode('mutant')
          yield* harness.provide('hitLimit', command.hitLimit)
          yield* harness.provide('mutantActivation', command.mutantActivation)
          yield* harness.provide('activeMutant', command.activeMutant.id)
          const { rawTests, hasExternalError, externalErrorText } = yield* collectRaw({
            testIds: (() => {
              if (command.testFilter !== undefined) return [...command.testFilter]
              return undefined
            })(),
            relatedFiles: [command.sandboxFileName],
          })
          const hitCount = yield* readHitCount.pipe(
            Effect.mapError((cause) =>
              new TestRunnerFailed({ runnerName: 'vitest', phase: 'mutantRun', cause: errorToString(cause) })
            ),
            Effect.option,
            Effect.map(Option.getOrUndefined),
          )
          const reportAllKillers = (() => {
            if (typeof input.options.disableBail === 'boolean') return input.options.disableBail
            return false
          })()
          const vitestOptions = yield* vitestOptionsEffect
          const namedTrapId = namedTrapIdOf(command.activeMutant, vitestOptions)
          return {
            rawTests,
            projectRoot: input.sandboxDirectory,
            hasExternalError,
            externalErrorText,
            hitCount,
            hitLimit: command.hitLimit,
            reportAllKillers,
            activeMutantId: command.activeMutant.id,
            namedTrapId,
          }
        })
      ).decode(Sandwich.pure((
        raw: {
          readonly rawTests: readonly RunnerTestCase[]
          readonly projectRoot: string
          readonly hasExternalError: boolean
          readonly externalErrorText: string
          readonly hitCount?: number | undefined
          readonly hitLimit: number | undefined
          readonly reportAllKillers: boolean
          readonly activeMutantId: string
          readonly namedTrapId: string | undefined
        },
      ) =>
        Result.succeed(
          new VitestMutantRunCommand({
            rawTests: raw.rawTests,
            projectRoot: raw.projectRoot,
            hasExternalError: raw.hasExternalError,
            externalErrorText: raw.externalErrorText,
            hitCount: raw.hitCount,
            hitLimit: raw.hitLimit,
            reportAllKillers: raw.reportAllKillers,
            activeMutantId: raw.activeMutantId,
            namedTrapId: raw.namedTrapId,
          }),
        )
      ))
        .decide(interpretVitestRun)
        .encode(Sandwich.pure((outcome: Result.Result<VitestMutantRunOutput, VitestMutantRunError>) =>
          Result.succeed(Result.match(outcome, {
            onFailure: (e) =>
              ({ status: 'error' as const, errorMessage: e.message }) satisfies MutantRunResult,
            onSuccess: (out) => {
              const nrOfTests = (): number => countIdRecords(parseJson(out.testsJson))
              return Match.value(out).pipe(
                Match.tag(
                  'Error',
                  (error) =>
                    ({
                      status: 'error' as const,
                      errorMessage: error.errorMessage ?? 'unknown',
                    }) satisfies MutantRunResult,
                ),
                Match.tag('Timeout', (timeout) =>
                  (() => {
                    if (timeout.reason === undefined) {
                      return { status: 'timeout' as const } satisfies MutantRunResult
                    }
                    return { status: 'timeout' as const, reason: timeout.reason } satisfies MutantRunResult
                  })()),
                Match.tag(
                  'Killed',
                  (killed) =>
                    ({
                      status: 'killed' as const,
                      failureMessage: killed.failureMessage ?? '',
                      killedBy: (() => {
                        if (killed.killerIds !== undefined) return [...killed.killerIds]
                        return []
                      })(),
                      nrOfTests: nrOfTests(),
                    }) satisfies MutantRunResult,
                ),
                Match.tag(
                  'Survived',
                  () => ({ status: 'survived' as const, nrOfTests: nrOfTests() }) satisfies MutantRunResult,
                ),
                Match.exhaustive,
              )
            },
          }))
        ))
        .write(<R = unknown>(output: MutantRunResult, _raw: R) =>
          Effect.succeed(output)
        )
      const dryRunFilter = (options: Parameters<TestRunner['Service']['dryRun']>[0]): RunFilter => {
        const relatedFiles = Option.getOrUndefined(
          Option.map(Option.fromNullishOr(options.files), (files) => [...files]),
        )
        return Match.value(testFilesProvided(options)).pipe(
          Match.when(true, (): RunFilter => ({
            testFiles: Option.getOrElse(
              Option.map(Option.fromNullishOr(options.testFiles), (files) => [...files]),
              (): string[] => [],
            ),
            relatedFiles,
          })),
          Match.orElse((): RunFilter => ({ relatedFiles })),
        )
      }

      const completeDryRun = (testsJson: string): Effect.Effect<DryRunResult, TestRunnerFailed> =>
        Effect.gen(function*() {
          const tests: readonly TestResult[] = Match.value(parseJson(testsJson)).pipe(
            Match.when(Array.isArray, (entries) => entries.filter(isTestResultLike)),
            Match.orElse((): readonly TestResult[] => []),
          )
          const mutantCoverage = yield* readMutantCoverage.pipe(
            Effect.mapError((cause) =>
              new TestRunnerFailed({ runnerName: 'vitest', phase: 'dryRun', cause: errorToString(cause) })
            ),
          )
          return Match.value(mutantCoverage).pipe(
            Match.when(Match.defined, (coverage) => ({ status: 'complete' as const, tests, mutantCoverage: coverage })),
            Match.orElse((): DryRunResult => ({ status: 'complete' as const, tests })),
          )
        })

      const dryRun: TestRunner['Service']['dryRun'] = (options) =>
        Effect.gen(function*() {
          const harness = yield* VitestHarness
          yield* harness.setMode('dry-run')
          const filter = dryRunFilter(options)
          const { rawTests, hasExternalError, externalErrorText } = yield* collectRaw(filter)
          const decision: VitestDryRunOutcome = decideVitestDryRun(
            new VitestDryRunCommand({
              rawTests,
              projectRoot: input.sandboxDirectory,
              hasExternalError,
              externalErrorText,
            }),
          )
          return yield* Match.value(decision).pipe(
            Match.tag(
              'Error',
              (error): Effect.Effect<DryRunResult, TestRunnerFailed> =>
                Effect.succeed(
                  { status: 'error' as const, errorMessage: error.errorMessage } satisfies DryRunResult,
                ),
            ),
            Match.tag('Complete', (complete) => completeDryRun(complete.testsJson)),
            Match.exhaustive,
          )
        }).pipe(
          Effect.provideService(VitestHarness, harnessImpl),
          Effect.mapError((cause) => ((() => {
            if (S.is(TestRunnerFailed)(cause)) return cause
            return new TestRunnerFailed({ runnerName: 'vitest', phase: 'dryRun', cause: errorToString(cause) })
          })())),
        )
      const mutantRun: TestRunner['Service']['mutantRun'] = (options) =>
        mutantRunCell.run(options).pipe(
          Effect.provideService(VitestHarness, harnessImpl),
          Effect.mapError((cause) => ((() => {
            if (S.is(TestRunnerFailed)(cause)) return cause
            return new TestRunnerFailed({ runnerName: 'vitest', phase: 'mutantRun', cause: errorToString(cause) })
          })())),
        )
      const removeSetupFile = (file: string) =>
        fsService.remove(file, { recursive: true, force: true }).pipe(Effect.orElseSucceed(() => undefined))
      const cleanupServices = Context.make(FileSystem.FileSystem, fsService)
      const disposeContext = (
        ctx: Vitest,
        localSetupFile: string | undefined,
      ): Effect.Effect<void, TestRunnerFailed> =>
        Effect.gen(function*() {
          Option.match(Option.fromNullishOr(localSetupFile), {
            onNone: (): void => undefined,
            onSome: (file): void => {
              ctx.onClose(() => Effect.runPromiseWith(cleanupServices)(removeSetupFile(file)))
            },
          })
          yield* Effect.tryPromise({
            try: () => ctx.close(),
            catch: (cause) =>
              new TestRunnerFailed({ runnerName: 'vitest', phase: 'dispose', cause: errorToString(cause) }),
          })
        })

      const dispose: TestRunner['Service']['dispose'] = Effect.gen(function*() {
        const state = yield* getState
        return yield* Option.match(Option.fromNullishOr(state.ctx), {
          onNone: () => Effect.void,
          onSome: (ctx) => disposeContext(ctx, state.localSetupFile),
        })
      })
      return TestRunner.of({ capabilities, init, dryRun, mutantRun, dispose })
    }),
  )

function isTestResultLike(value: unknown): value is TestResult {
  return Predicate.isObject(value) && typeof Reflect.get(value, 'id') === 'string'
}

function countIdRecords<A = unknown>(raw: A): number {
  if (Array.isArray(raw)) {
    return raw.filter(isTestResultLike).length
  }
  return 0
}

const mergeHitCount = (to: CoverageData, mutantId: string, hitCount: number): void =>
  Option.match(Option.fromNullishOr(to[mutantId]), {
    onNone: (): void => {
      to[mutantId] = hitCount
    },
    onSome: (existing): void => {
      to[mutantId] = existing + hitCount
    },
  })

function mergeCoverage(to: CoverageData, from: CoverageData): void {
  for (const [mutantId, hitCount] of Object.entries(from)) {
    mergeHitCount(to, mutantId, hitCount)
  }
}
