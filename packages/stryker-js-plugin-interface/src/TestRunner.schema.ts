/// <reference types="vitest/importMeta" />
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

import { NonNegativeFinite, NonNegativeInt } from './Metrics.schema.js'

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
  startPosition: S.optionalKey(Mutant.Position),
}

export const TestResultSchema = S.Union([
  S.Struct({ ...TestResultBase, status: S.Literal('failed'), failureMessage: S.String }),
  S.Struct({ ...TestResultBase, status: S.Literal('skipped') }),
  S.Struct({ ...TestResultBase, status: S.Literal('success') }),
])

export const MutantCoverageSchema = S.Struct({
  perTest: S.Record(S.String, S.Record(Mutant.MutantId, S.Finite)),
  static: S.Record(Mutant.MutantId, S.Finite),
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
    killedBy: S.Array(TestId),
    failureMessage: S.String,
    nrOfTests: NonNegativeInt,
  }),
  S.Struct({ status: S.Literal('survived'), nrOfTests: NonNegativeInt }),
  S.Struct({ status: S.Literal('timeout'), reason: S.optionalKey(S.String) }),
  S.Struct({ status: S.Literal('error'), errorMessage: S.String }),
])

export const CoverageAnalysisSchema = S.Literals(['off', 'all', 'perTest'])

export const DryRunOptionsSchema = S.Struct({
  ...Mutant.RunOptionsFields,
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
  readonly id: TestId
  readonly name: string
  readonly timeSpentMs: number
  readonly fileName?: string
  readonly startPosition?: Mutant.Position
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
  readonly mutantCoverage?: Mutant.MutantCoverage
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

export type CoverageAnalysis = 'off' | 'all' | 'perTest'

export interface DryRunOptions extends Mutant.RunOptions {
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
