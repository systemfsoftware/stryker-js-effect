import { Mutant, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const DryRunCoverageSchema = S.Struct({
  tests: S.Array(TestRunner.TestResultSchema),
  mutantCoverage: S.optional(Mutant.MutantCoverageSchema),
  globalTestInputs: S.Array(S.String),
  testFileModules: S.optionalKey(S.Record(S.String, S.Array(S.String))),
  timeOverheadMs: S.Finite,
  flakyTestIds: S.Array(S.String),
  flakyMutantIds: S.Array(S.String),
  testClosureDigest: S.String,
  runInputsDigest: S.String,
  projectRoot: S.optionalKey(S.String),
})

export type DryRunCoverage = S.Schema.Type<typeof DryRunCoverageSchema>

export const RecordedRootSchema = S.TaggedStruct('RecordedRoot', { path: S.String })

export const UnrecordedRootSchema = S.TaggedStruct('UnrecordedRoot', {})

export const CoverageRootSchema = S.Union([RecordedRootSchema, UnrecordedRootSchema])

export type CoverageRoot = typeof CoverageRootSchema.Type

export const DryRunCandidateRootsSchema = S.Struct({
  recordRoot: CoverageRootSchema,
  headerRoot: CoverageRootSchema,
})

export const PriorUnderCurrentRootSchema = S.TaggedStruct('PriorUnderCurrentRoot', {
  testClosureDigest: S.String,
  runInputsDigest: S.String,
})

export type PriorUnderCurrentRoot = typeof PriorUnderCurrentRootSchema.Type

export const DryRunReusePriorSchema = S.Union([
  S.TaggedStruct('NoPriorCoverage', {}),
  PriorUnderCurrentRootSchema,
  S.TaggedStruct('PriorUnderOtherRoots', {}),
  S.TaggedStruct('PriorRootUnrecorded', {}),
])

export type DryRunReusePrior = typeof DryRunReusePriorSchema.Type

export const DryRunRunReasonSchema = S.Literals([
  'noPriorCoverage',
  'closureUnavailable',
  'closureChanged',
  'runInputsChanged',
  'forced',
  'rootChanged',
  'rootUnrecorded',
])

export type DryRunRunReason = typeof DryRunRunReasonSchema.Type

export const DryRunPassSchema = S.Struct({
  tests: S.Array(TestRunner.TestResultSchema),
  mutantCoverage: S.optional(Mutant.MutantCoverageSchema),
})

export type DryRunPass = S.Schema.Type<typeof DryRunPassSchema>

export const ReportedDryRunCoverageSchema = S.Struct({
  projectRoot: S.optionalKey(S.String),
  dryRunCoverage: S.optionalKey(DryRunCoverageSchema),
})

export type ReportedDryRunCoverage = S.Schema.Type<typeof ReportedDryRunCoverageSchema>
