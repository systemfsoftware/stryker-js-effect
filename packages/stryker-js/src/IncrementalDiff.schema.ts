import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

export const FormatIdentitySchema = S.Struct({
  formatId: S.String,
  ownerModule: S.String,
  ownerVersion: S.String,
})

export type FormatIdentity = S.Schema.Type<typeof FormatIdentitySchema>

const PreviousMutantSchema = S.Struct({
  mutatorName: S.String,
  replacement: S.String,
  location: Mutant.Location,
  status: Mutant.MutantStatusSchema,
  testsCompleted: S.optional(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
})

const PreviousFileSchema = S.Struct({
  source: S.optional(S.String),
  mutants: PreviousMutantSchema.pipe(S.Array, S.optional),
  formatIdentity: S.optional(FormatIdentitySchema),
})

const PreviousTestFileSchema = S.Struct({
  source: S.optional(S.String),
})

export const PreviousFilesSchema = S.Record(S.String, PreviousFileSchema)
export const PreviousTestFilesSchema = S.Record(S.String, PreviousTestFileSchema)

export type PreviousFileRecord = S.Schema.Type<typeof PreviousFileSchema>
export type PreviousTestFileRecord = S.Schema.Type<typeof PreviousTestFileSchema>
export type PreviousMutantRecord = S.Schema.Type<typeof PreviousMutantSchema>
