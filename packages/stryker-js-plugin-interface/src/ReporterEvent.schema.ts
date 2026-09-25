/// <reference types="vitest/importMeta" />
import type * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { StandardSchemaV1 } from 'effect/StandardSchema'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { MetricsResultSchema, NonNegativeFinite, NonNegativeInt } from './Metrics.schema.js'

import { MutationTestResultSchema } from './Report.schema.js'
import type { StrykerOptions } from './stryker-options.schema.js'
import { TestResultSchema, TestRunnerCapabilitiesSchema } from './TestRunner.schema.js'

export const ReporterEventKind = S.Literals([
  'dryRunCompleted',
  'mutationTestingPlanReady',
  'mutantTested',
  'mutationTestReportReady',
])
export type ReporterEventKind = typeof ReporterEventKind.Type

export const RunTimingSchema = S.Struct({
  net: NonNegativeFinite,
  overhead: NonNegativeFinite,
})
export type RunTiming = typeof RunTimingSchema.Type

export const ReporterPlanKind = S.Literals(['EarlyResult', 'Run'])

export const ReporterPlanDescriptorSchema = S.Struct({
  mutantId: S.String,
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
  id: S.String,
  status: Mutant.MutantStatusSchema,
  file: S.String,
  location: Mutant.LocationSchema,
  mutator: S.String,
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
])

export type ReporterEvent = DryRunCompleted | MutationTestingPlanReady | MutantTested | MutationTestReportReady

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

type EventValidation = StandardSchemaV1.Result<ReporterEvent> | 'async'

const validateEvent = <T = unknown>(input: T): EventValidation => {
  const out = ReporterEventSchema['~standard'].validate(input)
  return out instanceof Promise ? 'async' : out
}

const reencoded = (value: ReporterEvent): string => JSON.stringify(encodeUnionEvent(value))

const isObjectValue = <T = unknown>(input: T): input is T & object => typeof input === 'object' && input !== null

const withTag = <T = unknown>(input: T, tag: string): T => isObjectValue(input) ? { ...input, _tag: tag } : input

const withoutTag = <T = unknown>(input: T): T => {
  if (!isObjectValue(input)) return input
  const copy = { ...input }
  Reflect.deleteProperty(copy, '_tag')
  return copy
}

const identity = <T = unknown>(input: T): T => input

const distributionOf = <T = unknown>(encoded: T): number => JSON.stringify(encoded).length % 3

type Corruption = <T = unknown>(encoded: T) => T

const CORRUPTION_BY_DRAW: Readonly<Record<number, Corruption>> = {
  0: identity,
  1: <T = unknown>(encoded: T): T => withTag(encoded, 'not-a-kind'),
  2: <T = unknown>(encoded: T): T => withoutTag(encoded),
}

const corruptByDraw = <T = unknown>(encoded: T): T => (CORRUPTION_BY_DRAW[distributionOf(encoded)] ?? identity)(encoded)

const injectCoverage = <T = unknown>(input: T): T =>
  isObjectValue(input)
    ? { ...input, mutantCoverage: { perTest: { t1: { m1: 1 } }, static: { m1: 2 } } }
    : input

const isAsyncResult = (result: EventValidation): result is 'async' => result === 'async'

const successToken = (standard: StandardSchemaV1.SuccessResult<ReporterEvent>): string =>
  'issues' in standard ? 'invalid' : `valid:${reencoded(standard.value)}`

const failureToken = (standard: StandardSchemaV1.FailureResult): string =>
  standard.issues.length > 0 ? 'invalid' : 'empty-invalid'

const standardAgreementToken = (standard: StandardSchemaV1.Result<ReporterEvent>): string =>
  'value' in standard ? successToken(standard) : failureToken(standard)

const decodeAgreementToken = <T = unknown>(input: T): string => {
  const decoded = S.decodeUnknownExit(ReporterEventUnion)(input)
  return Exit.isFailure(decoded) ? 'invalid' : `valid:${reencoded(decoded.value)}`
}

const agreesWithDecode = <T = unknown>(input: T): boolean => {
  const standard = validateEvent(input)
  if (isAsyncResult(standard)) return false
  return standardAgreementToken(standard) === decodeAgreementToken(input)
}

const resultShapeOf = (result: StandardSchemaV1.Result<ReporterEvent>): boolean =>
  'value' in result ? !('issues' in result) : result.issues.length > 0

const hasResultShape = (result: EventValidation): boolean => isAsyncResult(result) ? false : resultShapeOf(result)

const maybeResult = (result: EventValidation): Option.Option<StandardSchemaV1.Result<ReporterEvent>> =>
  isAsyncResult(result) ? Option.none() : Option.some(result)

const mutantCoverageAbsent = (result: StandardSchemaV1.Result<ReporterEvent>): boolean =>
  'value' in result && !('mutantCoverage' in result.value)

const absentCoverageAfterInjection = <T = unknown>(encoded: T): boolean =>
  Option.match(maybeResult(validateEvent(injectCoverage(encoded))), {
    onNone: () => false,
    onSome: mutantCoverageAbsent,
  })

const stripsMutantCoverage = <T = unknown>(encoded: T): boolean =>
  Option.isSome(maybeResult(validateEvent(encoded))) && absentCoverageAfterInjection(encoded)

const issueFingerprint = (result: StandardSchemaV1.FailureResult): string =>
  JSON.stringify(result.issues.map((issue) => ({ message: issue.message, path: issue.path })))

const issuesArePresent = (result: StandardSchemaV1.FailureResult): boolean => result.issues.length > 0

const fingerprintNames = (fingerprint: string): boolean =>
  fingerprint.includes('_tag') || fingerprint.includes('Expected')

const namesUnknownTag = (result: StandardSchemaV1.FailureResult): boolean =>
  issuesArePresent(result) ? fingerprintNames(issueFingerprint(result)) : false

const asFailure = (result: StandardSchemaV1.Result<ReporterEvent>): Option.Option<StandardSchemaV1.FailureResult> =>
  'value' in result ? Option.none() : Option.some(result)

const rejectableFailure = (result: EventValidation): Option.Option<StandardSchemaV1.FailureResult> =>
  isAsyncResult(result) ? Option.none() : asFailure(result)

const rejectsUnknownTag = (result: EventValidation): boolean =>
  Option.match(rejectableFailure(result), { onNone: () => false, onSome: namesUnknownTag })

const encodedEvent = (event: ReporterEvent) => encodeUnionEvent(event)

const encodedDryRun = (event: DryRunCompleted) => Result.getOrThrow(S.encodeResult(DryRunCompleted)(event))

const encodedMutantTested = (event: MutantTested) => Result.getOrThrow(S.encodeResult(MutantTested)(event))

const decodesBackTo = <A, I>(schema: S.Codec<A, I>, encoded: I, original: A): boolean =>
  Option.match(S.decodeUnknownOption(schema)(encoded), {
    onNone: () => false,
    onSome: (decoded) =>
      JSON.stringify(Result.getOrThrow(S.encodeResult(schema)(decoded))) ===
        JSON.stringify(Result.getOrThrow(S.encodeResult(schema)(original))),
  })

const encodeUnionEvent = (value: ReporterEvent) => Result.getOrThrow(S.encodeResult(ReporterEventUnion)(value))

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  it.prop(
    '∀e_Event_≡Decode',
    { of: [ReporterEventUnion], subject: encodedEvent },
    (encode, [event]) => agreesWithDecode(corruptByDraw(encode(event))),
  )

  it.prop(
    '∀e_Validate_≡Shape',
    { of: [ReporterEventUnion], subject: encodedEvent },
    (encode, [event]) => hasResultShape(validateEvent(corruptByDraw(encode(event)))),
  )

  it.prop(
    '∀d_DryRun_≠Coverage',
    { of: [DryRunCompleted], subject: encodedDryRun },
    (encode, [event]) => stripsMutantCoverage(encode(event)),
  )

  it.prop(
    '∀e_UnknownTag_≡Reject',
    { of: [ReporterEventUnion], subject: encodedEvent },
    (encode, [event]) => rejectsUnknownTag(validateEvent(withTag(encode(event), 'not-a-kind'))),
  )

  it.prop(
    '∀m_Tested_≡MachineAlphabet',
    { of: [MutantTested], subject: encodedMutantTested },
    (encode, [event]) => {
      const encoded = encode(event)
      const members = Object.keys(encoded).filter((key) => key !== '_tag').sort()
      const pinned = ['completed', 'file', 'id', 'location', 'mutator', 'replacement', 'status', 'total']
      return members.join(',') === pinned.join(',')
    },
  )

  it.prop(
    '∀e_Event_=Encode',
    { of: [ReporterEventUnion], subject: encodedEvent },
    (encode, [event]) => decodesBackTo(ReporterEventUnion, encode(event), event),
  )

  it.prop(
    '∀d_DryRun_=Encode',
    { of: [DryRunCompleted], subject: encodedDryRun },
    (encode, [event]) => decodesBackTo(DryRunCompleted, encode(event), event),
  )

  it.prop(
    '∀m_Tested_=Encode',
    { of: [MutantTested], subject: encodedMutantTested },
    (encode, [event]) => decodesBackTo(MutantTested, encode(event), event),
  )
}
