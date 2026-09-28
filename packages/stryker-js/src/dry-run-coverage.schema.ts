import { Mutant, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const DryRunCoverageSchema = S.Struct({
  tests: S.Array(TestRunner.TestResultSchema),
  mutantCoverage: S.optional(Mutant.MutantCoverageSchema),
  globalTestInputs: S.Array(S.String),
  timeOverheadMs: S.Finite,
  flakyTestIds: S.Array(S.String),
  flakyMutantIds: S.Array(S.String),
  testClosureDigest: S.String,
  runInputsDigest: S.String,
})

export type DryRunCoverage = S.Schema.Type<typeof DryRunCoverageSchema>

export const DryRunReusePriorSchema = S.Struct({
  testClosureDigest: S.String,
  runInputsDigest: S.String,
})

export type DryRunReusePrior = S.Schema.Type<typeof DryRunReusePriorSchema>

export const DryRunRunReasonSchema = S.Literals([
  'noPriorCoverage',
  'closureUnavailable',
  'closureChanged',
  'runInputsChanged',
  'forced',
])

export type DryRunRunReason = typeof DryRunRunReasonSchema.Type

export const DryRunPassSchema = S.Struct({
  tests: S.Array(TestRunner.TestResultSchema),
  mutantCoverage: S.optional(Mutant.MutantCoverageSchema),
})

export type DryRunPass = S.Schema.Type<typeof DryRunPassSchema>

export const ReportedDryRunCoverageSchema = S.Struct({ dryRunCoverage: S.optionalKey(DryRunCoverageSchema) })

export type ReportedDryRunCoverage = S.Schema.Type<typeof ReportedDryRunCoverageSchema>
