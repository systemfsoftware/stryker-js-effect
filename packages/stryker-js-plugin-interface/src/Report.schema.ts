import { SchemaGetter, SchemaTransformation } from 'effect'
import * as S from 'effect/Schema'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { NonNegativeFinite, NonNegativeInt, Percentage } from './Metrics.schema.js'

export const MutantResultSchema = S.Struct({
  id: S.String,
  mutatorName: S.String,
  status: Mutant.MutantStatusSchema,
  location: Mutant.LocationSchema,
  replacement: S.optional(S.String),
  description: S.optional(S.String),
  statusReason: S.optional(S.String),
  static: S.optional(S.Boolean),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
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
  location: S.optional(Mutant.OpenEndLocationSchema),
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
})
type ThresholdsValues = S.Schema.Type<typeof ThresholdsValuesSchema>

const isThresholds = (value: unknown): value is ThresholdsValues =>
  S.is(ThresholdsValuesSchema)(value) && value.low <= value.high

/**
 * The pair is *built* ordered — a drawn pair is sorted — rather than drawn at
 * random and discarded until it happens to be ordered. The invariant lives on
 * the declaration because a filter over the pair cannot express `low <= high`
 * in the generation-constraint vocabulary, and only a declaration carries a
 * `toCodecArbitrary` derivation. `ThresholdsValuesSchema` stays the wire side, so
 * decoding keeps its field paths.
 */
const OrderedThresholds = S.declare<ThresholdsValues>(isThresholds, {
  message: 'expected thresholds where low <= high',
  toCodecArbitrary: () =>
    S.link<ThresholdsValues>()(ThresholdsValuesSchema, {
      decode: SchemaGetter.transform(({ high, low }) => ({ high: Math.max(high, low), low: Math.min(high, low) })),
      encode: SchemaGetter.transform((thresholds) => thresholds),
    }),
})

export const ThresholdsSchema = ThresholdsValuesSchema.pipe(
  S.decodeTo(OrderedThresholds, SchemaTransformation.passthrough()),
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
