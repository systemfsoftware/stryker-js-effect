import { SchemaGetter } from 'effect'
import * as S from 'effect/Schema'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { NonNegativeFinite, NonNegativeInt, Percentage } from './Metrics.schema.js'
import { TestId } from './TestRunner.schema.js'

export const MutantResultSchema = S.Struct({
  id: Mutant.MutantId,
  mutatorName: S.String,
  status: Mutant.MutantStatusSchema,
  location: Mutant.Location,
  replacement: S.optional(S.String),
  description: S.optional(S.String),
  statusReason: S.optional(S.String),
  static: S.optional(S.Boolean),
  coveredBy: S.Array(TestId).pipe(S.optional),
  killedBy: S.Array(TestId).pipe(S.optional),
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
  id: TestId,
  name: S.String,
  location: S.optional(Mutant.OpenEndLocation),
})
export type TestDefinition = typeof TestDefinitionSchema.Type

export const TestFileSchema = S.Struct({
  source: S.optional(S.String),
  tests: S.Array(TestDefinitionSchema),
})
export type TestFile = typeof TestFileSchema.Type

export const TestFileDefinitionDictionarySchema = S.Record(S.String, TestFileSchema)
export type TestFileDefinitionDictionary = typeof TestFileDefinitionDictionarySchema.Type

const ThresholdsValuesSchema = S.Struct({
  high: Percentage,
  low: Percentage,
  break: S.NullOr(Percentage),
})
type ThresholdsValues = typeof ThresholdsValuesSchema.Type

const isOrderedThresholds = (value: unknown): value is ThresholdsValues =>
  S.is(ThresholdsValuesSchema)(value) && value.low <= value.high

export const OrderedThresholds = S.declare<ThresholdsValues>(isOrderedThresholds, {
  message: 'a mutation score threshold pair has low at or below high',
  toCodecArbitrary: () =>
    S.link<ThresholdsValues>()(ThresholdsValuesSchema, {
      decode: SchemaGetter.transform(({ break: breaking, high, low }) => ({
        break: breaking,
        high: Math.max(high, low),
        low: Math.min(high, low),
      })),
      encode: SchemaGetter.transform((thresholds) => thresholds),
    }),
})

export const ThresholdsSchema = S.declare<ThresholdsValues>(isOrderedThresholds, {
  message: 'a mutation score threshold pair has low at or below high',
  toCodecArbitrary: () =>
    S.link<ThresholdsValues>()(ThresholdsValuesSchema, {
      decode: SchemaGetter.transform(({ break: breaking, high, low }) => ({
        break: breaking,
        high: Math.max(high, low),
        low: Math.min(low, high),
      })),
      encode: SchemaGetter.transform((thresholds) => thresholds),
    }),
})
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
