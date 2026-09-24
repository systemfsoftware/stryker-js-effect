import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import { SchemaGetter } from 'effect'

export const DryRunStatus = S.Literals(['complete', 'error', 'timeout'])
export type DryRunStatus = typeof DryRunStatus.Type

export const TestStatus = S.Literals(['success', 'failed', 'skipped'])
export type TestStatus = typeof TestStatus.Type

export const MutantRunStatus = S.Literals(['killed', 'survived', 'timeout', 'error'])
export type MutantRunStatus = typeof MutantRunStatus.Type

const TestResultBase = {
  id: S.String,
  name: S.String,
  timeSpentMs: S.Finite,
  fileName: S.optionalKey(S.String),
  startPosition: S.optionalKey(PositionSchema),
}

export const TestResultSchema = S.Union([
  S.Struct({ ...TestResultBase, status: S.Literal('failed'), failureMessage: S.String }),
  S.Struct({ ...TestResultBase, status: S.Literal('skipped') }),
  S.Struct({ ...TestResultBase, status: S.Literal('success') }),
])

export const MutantCoverageSchema = S.Struct({
  perTest: S.Record(S.String, S.Record(S.String, S.Finite)),
  static: S.Record(S.String, S.Finite),
})

export const DryRunResultSchema = S.Union([
  S.Struct({
    status: S.Literal('complete'),
    tests: S.Array(TestResultSchema),
    mutantCoverage: S.optionalKey(MutantCoverageSchema),
  }),
  S.Struct({ status: S.Literal('timeout'), reason: S.optionalKey(S.String) }),
  S.Struct({ status: S.Literal('error'), errorMessage: S.String }),
])

export const MutantRunResultSchema = S.Union([
  S.Struct({
    status: S.Literal('killed'),
    killedBy: S.Array(S.String),
    failureMessage: S.String,
    nrOfTests: S.Finite,
  }),
  S.Struct({ status: S.Literal('survived'), nrOfTests: S.Finite }),
  S.Struct({ status: S.Literal('timeout'), reason: S.optionalKey(S.String) }),
  S.Struct({ status: S.Literal('error'), errorMessage: S.String }),
])

export const CoverageAnalysisSchema = S.Literals(['off', 'all', 'perTest'])

export const DryRunOptionsSchema = S.Struct({
  ...RunOptionsFields,
  coverageAnalysis: CoverageAnalysisSchema,
  files: S.String.pipe(S.Array, S.optionalKey),
  testFiles: S.String.pipe(S.Array, S.optionalKey),
})

export const TestRunnerCapabilitiesSchema = S.Struct({
  reloadEnvironment: S.Boolean,
})

export class TestRunnerFailed extends S.TaggedError<TestRunnerFailed>()('TestRunnerFailed', {
  cause: S.String,
  phase: S.Literals(['capabilities', 'dispose', 'dryRun', 'init', 'mutantRun']),
  runnerName: S.String,
}) {}

export interface BaseTestResult {
  readonly id: string
  readonly name: string
  readonly timeSpentMs: number
  readonly fileName?: string
  readonly startPosition?: Position
}

export interface FailedTestResult extends BaseTestResult {
  readonly status: 'failed'
  readonly failureMessage: string
}

export interface SkippedTestResult extends BaseTestResult {
  readonly status: 'skipped'
}

export interface SuccessTestResult extends BaseTestResult {
  readonly status: 'success'
}

export type TestResult = FailedTestResult | SkippedTestResult | SuccessTestResult

export interface CompleteDryRunResult {
  readonly tests: readonly TestResult[]
  readonly mutantCoverage?: MutantCoverage
  readonly status: 'complete'
}

export interface TimeoutDryRunResult {
  readonly status: 'timeout'
  readonly reason?: string
}

export interface ErrorDryRunResult {
  readonly status: 'error'
  readonly errorMessage: string
}

export type DryRunResult = CompleteDryRunResult | ErrorDryRunResult | TimeoutDryRunResult

export interface TimeoutMutantRunResult {
  readonly status: 'timeout'
  readonly reason?: string
}

export interface KilledMutantRunResult {
  readonly status: 'killed'
  readonly killedBy: readonly string[]
  readonly failureMessage: string
  readonly nrOfTests: number
}

export interface SurvivedMutantRunResult {
  readonly status: 'survived'
  readonly nrOfTests: number
}

export interface ErrorMutantRunResult {
  readonly status: 'error'
  readonly errorMessage: string
}

export type MutantRunResult =
  | ErrorMutantRunResult
  | KilledMutantRunResult
  | SurvivedMutantRunResult
  | TimeoutMutantRunResult

const firstFailedTestOf = (tests: readonly TestResult[]) =>
  Option.fromUndefinedOr(failedTestsOf(tests).at(0))

const failedTestsOf = (tests: readonly TestResult[]) =>
  tests.filter((test): test is FailedTestResult => test.status === 'failed')

const countedTestsOf = (tests: readonly TestResult[]) => tests.filter((test) => test.status !== 'skipped').length

const killersOf = (
  failed: readonly FailedTestResult[],
  firstFailed: FailedTestResult,
  reportAllKillers: boolean,
) =>
  Match.value(reportAllKillers).pipe(
    Match.when(true, () => failed.map((test) => test.id)),
    Match.when(false, () => [firstFailed.id]),
    Match.exhaustive,
  )

const killedResultOf = (
  complete: CompleteDryRunResult,
  failed: readonly FailedTestResult[],
  firstFailed: FailedTestResult,
  reportAllKillers: boolean,
): KilledMutantRunResult => ({
  failureMessage: firstFailed.failureMessage,
  killedBy: killersOf(failed, firstFailed, reportAllKillers),
  nrOfTests: countedTestsOf(complete.tests),
  status: 'killed',
})

const reasonedTimeoutOf = (timedOut: TimeoutDryRunResult): TimeoutMutantRunResult =>
  Option.match(Option.fromUndefinedOr(timedOut.reason), {
    onNone: (): TimeoutMutantRunResult => ({ status: 'timeout' }),
    onSome: (reason): TimeoutMutantRunResult => ({ reason, status: 'timeout' }),
  })

const completeResultOf = (complete: CompleteDryRunResult, reportAllKillers: boolean): MutantRunResult =>
  Option.match(firstFailedTestOf(complete.tests), {
    onNone: (): MutantRunResult => ({ nrOfTests: countedTestsOf(complete.tests), status: 'survived' }),
    onSome: (firstFailed): MutantRunResult =>
      killedResultOf(complete, failedTestsOf(complete.tests), firstFailed, reportAllKillers),
  })

const erroredResultOf = (errored: ErrorDryRunResult): MutantRunResult => ({
  errorMessage: errored.errorMessage,
  status: 'error',
})

export const decodeMutantRunResult = (options: { readonly reportAllKillers: boolean }) =>
  SchemaGetter.transform((dryRunResult: DryRunResult): MutantRunResult =>
    Match.value(dryRunResult).pipe(
      Match.discriminator('status')('complete', (complete) => completeResultOf(complete, options.reportAllKillers)),
      Match.discriminator('status')('error', erroredResultOf),
      Match.discriminator('status')('timeout', reasonedTimeoutOf),
      Match.exhaustive,
    )
  )


export type CoverageAnalysis = 'off' | 'all' | 'perTest'

export interface DryRunOptions extends RunOptions {
  readonly coverageAnalysis: CoverageAnalysis
  readonly files?: readonly string[]
  readonly testFiles?: readonly string[]
}

export interface TestRunnerCapabilities {
  readonly reloadEnvironment: boolean
}
