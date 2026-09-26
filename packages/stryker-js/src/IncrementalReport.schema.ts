import * as S from 'effect/Schema'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'

import { FormatIdentitySchema } from './IncrementalDiff.schema.js'

const MutantResultLikeSchema = S.Struct({
  id: S.String,
  mutatorName: S.String,
  replacement: S.String,
  location: Mutant.Location,
  status: Mutant.MutantStatusSchema,
  killedBy: S.String.pipe(S.Array, S.optional),
  coveredBy: S.String.pipe(S.Array, S.optional),
  static: S.optional(S.Boolean),
  statusReason: S.optional(S.String),
  testsCompleted: S.optional(S.Finite),
  description: S.optional(S.String),
  duration: S.optional(S.Finite),
})

const FileResultLikeSchema = S.Struct({
  language: S.String,
  source: S.String,
  mutants: S.Array(MutantResultLikeSchema),
  formatIdentity: S.optional(FormatIdentitySchema),
})

const TestDefinitionLikeSchema = S.Struct({
  id: S.String,
  name: S.String,
  location: S.optional(Mutant.OpenEndLocation),
})

const TestFileLikeSchema = S.Struct({
  source: S.optional(S.String),
  tests: S.Array(TestDefinitionLikeSchema),
})

const ThresholdsLikeSchema = S.Struct({
  high: S.Finite,
  low: S.Finite,
})

export const IncrementalReportSchema = S.StructWithRest(
  S.Struct({
    incrementalVersion: S.String,
    schemaVersion: S.String,
    thresholds: ThresholdsLikeSchema,
    files: S.Record(S.String, FileResultLikeSchema),
    testFiles: S.optional(S.Record(S.String, TestFileLikeSchema)),
  }),
  [S.Record(S.String, S.Unknown)],
)

export type IncrementalReport = S.Schema.Type<typeof IncrementalReportSchema>
