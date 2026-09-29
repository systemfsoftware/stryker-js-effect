import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const FormatIdentitySchema = S.Struct({
  formatId: S.String,
  ownerModule: S.String,
  ownerVersion: S.String,
})

export type FormatIdentity = S.Schema.Type<typeof FormatIdentitySchema>

export const ReuseRefusalReasonSchema = S.Literals([
  'semanticsChanged',
  'policyChanged',
  'runInputsChanged',
  'closureChanged',
  'flakyDependency',
  'timeoutUnreproduced',
  'noPriorRecord',
])

export type ReuseRefusalReason = typeof ReuseRefusalReasonSchema.Type

export const ClosureDigestsSchema = S.Record(Mutant.MutantId, S.String)

export type ClosureDigests = S.Schema.Type<typeof ClosureDigestsSchema>

export const TimeoutKindSchema = S.Literals(['wallClock', 'hitLimit'])

export type TimeoutKind = typeof TimeoutKindSchema.Type

export const TimeoutEvidenceSchema = S.Struct({
  timeoutKind: TimeoutKindSchema,
  reproductions: S.Natural,
})

export type TimeoutEvidence = S.Schema.Type<typeof TimeoutEvidenceSchema>

export const PreviousReuseRecordSchema = S.Struct({
  mutantId: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
  closureDigest: S.optional(S.String),
  verdictSemanticsVersion: S.Int,
  mutantSetPolicy: Options.MutantSetPolicy,
  runInputsDigest: S.String,
  timeoutKind: S.optional(TimeoutKindSchema),
  reproductions: S.optional(S.Natural),
  testsCompleted: S.optional(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
})

export type PreviousReuseRecord = S.Schema.Type<typeof PreviousReuseRecordSchema>

const ReuseMutantSchema = S.Struct({
  id: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
  closureDigest: S.optional(S.String),
  timeoutKind: S.optional(TimeoutKindSchema),
  reproductions: S.optional(S.Natural),
  testsCompleted: S.optional(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
})

const ReuseFileSchema = S.Struct({
  mutants: S.Array(ReuseMutantSchema),
})

export const ReuseTestDefinitionSchema = S.Struct({
  id: S.String,
  name: S.String,
})

export const ReuseTestFileSchema = S.Struct({
  tests: S.Array(ReuseTestDefinitionSchema),
})

export type ReuseTestFile = typeof ReuseTestFileSchema.Type

export const ReuseTestFilesSchema = S.Record(S.String, ReuseTestFileSchema)

export type ReuseTestFiles = typeof ReuseTestFilesSchema.Type

export const ReuseReportSchema = S.Struct({
  verdictSemanticsVersion: S.Int,
  mutantSetPolicy: Options.MutantSetPolicy,
  runInputsDigest: S.String,
  files: S.Record(S.String, ReuseFileSchema),
  testFiles: S.optional(ReuseTestFilesSchema),
})

export type ReuseReport = S.Schema.Type<typeof ReuseReportSchema>
