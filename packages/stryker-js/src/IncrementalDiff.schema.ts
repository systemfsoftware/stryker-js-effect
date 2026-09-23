import * as S from 'effect/Schema'

const PositionSchema = S.Struct({ line: S.Finite, column: S.Finite })
const PreviousLocationSchema = S.Struct({ start: PositionSchema, end: PositionSchema })

const PreviousMutantSchema = S.Struct({
  mutatorName: S.String,
  replacement: S.String,
  location: PreviousLocationSchema,
  status: S.String,
  testsCompleted: S.optional(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
})

const PreviousFileSchema = S.Struct({
  source: S.optional(S.String),
  mutants: PreviousMutantSchema.pipe(S.Array, S.optional),
})

const PreviousTestFileSchema = S.Struct({
  source: S.optional(S.String),
})

export const PreviousFilesSchema = S.Record(S.String, PreviousFileSchema)
export const PreviousTestFilesSchema = S.Record(S.String, PreviousTestFileSchema)

export type PreviousFileRecord = S.Schema.Type<typeof PreviousFileSchema>
export type PreviousTestFileRecord = S.Schema.Type<typeof PreviousTestFileSchema>
export type PreviousMutantRecord = S.Schema.Type<typeof PreviousMutantSchema>
