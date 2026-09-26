import type * as Effect from 'effect/Effect'
import * as S from 'effect/Schema'
import type { StandardSchemaV1 } from 'effect/StandardSchema'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { MetricsResultSchema, NonNegativeFinite, NonNegativeInt } from './Metrics.schema.js'

import { MutationTestResultSchema } from './Report.schema.js'
import type { StrykerOptions } from './stryker-options.schema.js'
import { TestResultSchema, TestRunnerCapabilitiesSchema } from './TestRunner.schema.js'

export const RunTimingSchema = S.Struct({
  net: NonNegativeFinite,
  overhead: NonNegativeFinite,
})
export type RunTiming = typeof RunTimingSchema.Type

export const ReporterPlanKind = S.Literals(['EarlyResult', 'Run'])

export const ReporterPlanDescriptorSchema = S.Struct({
  mutantId: Mutant.MutantId,
  plan: ReporterPlanKind,
  netTime: NonNegativeFinite,
  reloadEnvironment: S.Boolean,
})
export type ReporterPlanDescriptor = typeof ReporterPlanDescriptorSchema.Type

export class DryRunCompleted extends S.TaggedClass<DryRunCompleted>()('dryRunCompleted', {
  timing: RunTimingSchema,
  capabilities: TestRunnerCapabilitiesSchema,
  testCount: NonNegativeInt,
  tests: S.Array(TestResultSchema),
}) {}

export class MutationTestingPlanReady extends S.TaggedClass<MutationTestingPlanReady>()(
  'mutationTestingPlanReady',
  {
    total: NonNegativeInt,
    plans: S.Array(ReporterPlanDescriptorSchema),
  },
) {}

export class MutantTested extends S.TaggedClass<MutantTested>()('mutantTested', {
  id: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
  fileName: Mutant.CanonicalFileName,
  location: Mutant.Location,
  mutatorName: Mutant.MutatorName,
  replacement: S.NullOr(S.String),
  completed: NonNegativeInt,
  total: NonNegativeInt,
}) {}

export class MutationTestReportReady extends S.TaggedClass<MutationTestReportReady>()(
  'mutationTestReportReady',
  {
    report: MutationTestResultSchema,
    metrics: MetricsResultSchema,
  },
) {}

export const ReporterEventUnion = S.Union([
  DryRunCompleted,
  MutationTestingPlanReady,
  MutantTested,
  MutationTestReportReady,
]).pipe(S.toTaggedUnion('_tag'))

export type ReporterEvent = typeof ReporterEventUnion.Type

export const ReporterEventKind = S.Literals(ReporterEventUnion.discriminants)
export type ReporterEventKind = typeof ReporterEventKind.Type

const standardReporterEvents = S.toStandardSchemaV1(ReporterEventUnion)

export const ReporterEventSchema: StandardSchemaV1<typeof ReporterEventUnion['Encoded'], ReporterEvent> =
  standardReporterEvents

export interface ReporterInit {
  readonly traceparent?: string | undefined
  readonly tracestate?: string | undefined
}

export type ReporterFactory = (
  options: StrykerOptions,
  init: ReporterInit,
) => (events: AsyncIterable<ReporterEvent>) => Effect.Effect<void, ReporterFailed>

export class ReporterFailed extends S.TaggedError<ReporterFailed>()('ReporterFailed', {
  cause: S.String,
  event: ReporterEventKind,
  reporterName: S.String,
}) {}
