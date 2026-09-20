import * as S from 'effect/Schema'

import { LocationSchema, MutantStatusSchema, OpenEndLocationSchema } from '@systemfsoftware/stryker-js-instrumenter'
import { NonNegativeFinite, NonNegativeInt, Percentage } from './Metrics.schema.js'

export const MutantResultSchema = S.Struct({
  id: S.String,
  mutatorName: S.String,
  status: MutantStatusSchema,
  location: LocationSchema,
  replacement: S.optional(S.String),
  description: S.optional(S.String),
  statusReason: S.optional(S.String),
  static: S.optional(S.Boolean),
  coveredBy: S.optional(S.Array(S.String)),
  killedBy: S.optional(S.Array(S.String)),
  testsCompleted: S.optional(NonNegativeInt),
  duration: S.optional(NonNegativeFinite),
})
export type MutantResult = typeof MutantResultSchema.Type

export const FileResultSchema = S.Struct({
  language: S.String,
  source: S.String,
  mutants: S.Array(MutantResultSchema),
})
export type FileResult = typeof FileResultSchema.Type

export const FileResultDictionarySchema = S.Record(S.String, FileResultSchema)
export type FileResultDictionary = typeof FileResultDictionarySchema.Type

export const TestDefinitionSchema = S.Struct({
  id: S.String,
  name: S.String,
  location: S.optional(OpenEndLocationSchema),
})
export type TestDefinition = typeof TestDefinitionSchema.Type

export const TestFileSchema = S.Struct({
  source: S.optional(S.String),
  tests: S.Array(TestDefinitionSchema),
})
export type TestFile = typeof TestFileSchema.Type

export const TestFileDefinitionDictionarySchema = S.Record(S.String, TestFileSchema)
export type TestFileDefinitionDictionary = typeof TestFileDefinitionDictionarySchema.Type

export const ThresholdsSchema = S.Struct({
  high: Percentage,
  low: Percentage,
}).pipe(
  S.check(
    S.makeFilter((t) => t.low <= t.high, {
      expected: 'thresholds where low <= high',
      arbitrary: {
        candidate: {
          make: (fc) =>
            fc
              .tuple(
                fc.float({ min: 0, max: 100, noNaN: true }),
                fc.float({ min: 0, max: 100, noNaN: true }),
              )
              .map(([a, b]) => ({ high: Math.max(a, b), low: Math.min(a, b) })),
        },
      },
    }),
  ),
)
export type Thresholds = typeof ThresholdsSchema.Type

export const BrandingInformationSchema = S.Struct({
  homepageUrl: S.String,
  imageUrl: S.optional(S.String),
})
export type BrandingInformation = typeof BrandingInformationSchema.Type

export const DependenciesSchema = S.Record(S.String, S.String)
export type Dependencies = typeof DependenciesSchema.Type

export const FrameworkInformationSchema = S.Struct({
  name: S.String,
  version: S.optional(S.String),
  branding: S.optional(BrandingInformationSchema),
  dependencies: S.optional(DependenciesSchema),
})
export type FrameworkInformation = typeof FrameworkInformationSchema.Type

export const MutationTestResultSchema = S.Struct({
  schemaVersion: S.String,
  files: FileResultDictionarySchema,
  thresholds: ThresholdsSchema,
  config: S.optional(S.Record(S.String, S.Unknown)),
  testFiles: S.optional(TestFileDefinitionDictionarySchema),
  projectRoot: S.optional(S.String),
  framework: S.optional(FrameworkInformationSchema),
})
export type MutationTestResult = typeof MutationTestResultSchema.Type
