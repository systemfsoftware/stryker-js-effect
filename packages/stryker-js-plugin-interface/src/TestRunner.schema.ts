/// <reference types="vitest/importMeta" />
import * as S from 'effect/Schema'

import { Position } from './Location.schema.js'
import { NonNegativeFinite, NonNegativeInt } from './Metrics.schema.js'
import { MutantCoverageSchema, RunOptionsFields } from './Mutant.schema.js'
import type { MutantCoverage, RunOptions } from './Mutant.schema.js'

const isTestId = (value: string): boolean => value.length > 0

export const TestId = S.NonEmptyString.pipe(S.brand('TestId'))
export type TestId = typeof TestId.Type

const acceptsTestId = (value: string): boolean => S.is(TestId)(value)

export const DryRunStatus = S.Literals(['complete', 'error', 'timeout'])
export type DryRunStatus = typeof DryRunStatus.Type

export const TestStatus = S.Literals(['success', 'failed', 'skipped'])
export type TestStatus = typeof TestStatus.Type

export const MutantRunStatus = S.Literals(['killed', 'survived', 'timeout', 'error'])
export type MutantRunStatus = typeof MutantRunStatus.Type

const TestResultBase = {
  id: TestId,
  name: S.String,
  timeSpentMs: NonNegativeFinite,
  fileName: S.optionalKey(S.String),
  startPosition: S.optionalKey(Position),
}

export const TestResultSchema = S.Union([
  S.Struct({ ...TestResultBase, status: S.Literal('failed'), failureMessage: S.String }),
  S.Struct({ ...TestResultBase, status: S.Literal('skipped') }),
  S.Struct({ ...TestResultBase, status: S.Literal('success') }),
])

export const DryRunResultSchema = S.Union([
  S.Struct({
    status: S.Literal('complete'),
    tests: S.Array(TestResultSchema),
    mutantCoverage: S.optionalKey(MutantCoverageSchema),
    globalTestInputs: S.String.pipe(S.Array, S.optionalKey),
  }),
  S.Struct({ status: S.Literal('timeout'), reason: S.optionalKey(S.String) }),
  S.Struct({ status: S.Literal('error'), errorMessage: S.String }),
])

export const MutantRunResultSchema = S.Union([
  S.Struct({
    status: S.Literal('killed'),
    killedBy: S.Array(TestId),
    failureMessage: S.String,
    nrOfTests: NonNegativeInt,
    executedTests: TestId.pipe(S.Array, S.optionalKey),
  }),
  S.Struct({
    status: S.Literal('survived'),
    nrOfTests: NonNegativeInt,
    executedTests: TestId.pipe(S.Array, S.optionalKey),
  }),
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
}) {
  override get message(): string {
    return `Test runner "${this.runnerName}" failed during ${this.phase}: ${this.cause}`
  }
}

export interface BaseTestResult {
  readonly id: TestId
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
  readonly globalTestInputs?: readonly string[]
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
  readonly killedBy: readonly TestId[]
  readonly failureMessage: string
  readonly nrOfTests: number
  readonly executedTests?: readonly TestId[]
}

export interface SurvivedMutantRunResult {
  readonly status: 'survived'
  readonly nrOfTests: number
  readonly executedTests?: readonly TestId[]
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

export type CoverageAnalysis = 'off' | 'all' | 'perTest'

export interface DryRunOptions extends RunOptions {
  readonly coverageAnalysis: CoverageAnalysis
  readonly files?: readonly string[]
  readonly testFiles?: readonly string[]
}

export interface TestRunnerCapabilities {
  readonly reloadEnvironment: boolean
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const seeds = ['', ' ', 'a', 'file.ts#test']
  it.prop(
    '∀s_TestIdRefusal_≡NonEmpty',
    { of: [S.String], subject: acceptsTestId },
    (subject, [drawn]) => Arr.every(Arr.append(seeds, drawn), (value) => subject(value) === isTestId(value)),
  )
}
