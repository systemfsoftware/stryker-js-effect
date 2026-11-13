/// <reference types="vitest/importMeta" />
import { dual } from 'effect/Function'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

import { ignoreStatusReasonText } from './ignore-rule.schema.js'
import { Location } from './Location.schema.js'

export const MutantStatusSchema = S.Literals([
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Ignored',
  'Pending',
])
export type MutantStatus = typeof MutantStatusSchema.Type

export const SurvivorStatusSchema = S.Literals(['Survived', 'NoCoverage'])
export type SurvivorStatus = typeof SurvivorStatusSchema.Type

export const RememberedStatusSchema = S.Literals([
  'Survived',
  'Killed',
  'Timeout',
  'NoCoverage',
  'Ignored',
  'CompileError',
])
export type RememberedStatus = typeof RememberedStatusSchema.Type

export const EphemeralStatusSchema = S.Literals(['CompileError', 'RuntimeError', 'Pending'])
export type EphemeralStatus = typeof EphemeralStatusSchema.Type

export const ActionableStatusSchema = S.Literals(['Survived', 'NoCoverage', 'Timeout', 'RuntimeError'])
export type ActionableStatus = typeof ActionableStatusSchema.Type

export const SettledStatusSchema = MutantStatusSchema.pick([
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Pending',
])
export type SettledStatus = typeof SettledStatusSchema.Type

export const MutantId = S.String.check(
  S.isPattern(/^[0-9a-f]{16}$/u, {
    expected: 'a 16-character lowercase hexadecimal mutant id',
  }),
).pipe(S.brand('MutantId'))
export type MutantId = typeof MutantId.Type

export const MutatorNameGrammar = S.String.check(
  S.isPattern(/^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/)?[A-Z][A-Za-z0-9]*$/u, {
    expected: 'a PascalCase mutator name, optionally prefixed by a lowercase kebab-case namespace and a slash',
  }),
)

export const MutatorName = MutatorNameGrammar.pipe(S.brand('MutatorName'))
export type MutatorName = typeof MutatorName.Type

export const CanonicalFileName = S.String.pipe(
  S.decodeTo(S.String.pipe(S.check(S.isPattern(/^[^\\]+$/u)), S.brand('CanonicalFileName')), {
    decode: SGetter.transform((fileName) => fileName.replace(/\\/g, '/')),
    encode: SGetter.transform((canonical) => canonical),
  }),
)
export type CanonicalFileName = typeof CanonicalFileName.Type

export const Subsumed = S.TaggedStruct('Subsumed', {
  rule: S.Literals(['complement']),
  dominators: S.NonEmptyArray(MutantId),
})
export type Subsumed = typeof Subsumed.Type

export const subsumedStatusReason = (subsumed: Subsumed): string =>
  ignoreStatusReasonText({
    code: 'redundant-relational',
    detail: `subsumed by ${subsumed.dominators[0]} (${subsumed.rule}): every test that kills ${
      subsumed.dominators[0]
    } kills this mutant, so act on ${subsumed.dominators[0]}, or set mutator.mutantSetPolicy 'full' to run it`,
  })

/**
 * Why a subsumed mutant ran after all: none of its dominators ran, and each
 * cause names one dominator and why it did not run, in `dominators` order.
 */
export const ReadmitCauseCode = S.Literals([
  'dominator-ignored-at-check',
  'dominator-compile-error',
  'dominator-ignored-at-plan',
  'dominator-remembered-without-running',
  'dominator-unsettled',
])
export type ReadmitCauseCode = typeof ReadmitCauseCode.Type

export const Readmitted = S.TaggedStruct('Readmitted', {
  rule: Subsumed.fields.rule,
  causes: S.NonEmptyArray(S.Struct({ dominator: MutantId, code: ReadmitCauseCode, detail: S.String })),
})
export type Readmitted = typeof Readmitted.Type

export const Subsumption = S.Union([Subsumed, Readmitted])
export type Subsumption = typeof Subsumption.Type

export const subsumptionMatchesStatus: {
  (status: MutantStatus | undefined): (subsumption: Subsumption) => boolean
  (subsumption: Subsumption, status: MutantStatus | undefined): boolean
} = dual(
  2,
  (subsumption: Subsumption, status: MutantStatus | undefined): boolean =>
    S.is(Subsumed)(subsumption) ? status === 'Ignored' : status !== 'Ignored',
)

/**
 * A mutant's file location in the mutation-testing-report-schema contract:
 * 1-based line and 1-based column, the same base the JSON report and the
 * machine stream emit. Every producer on the instrument path (node spans,
 * embedded-region shifts) targets this base; no downstream layer converts.
 */
export const Mutant = S.TaggedStruct('Mutant', {
  id: MutantId,
  fileName: CanonicalFileName,
  mutatorName: MutatorName,
  replacement: S.String,
  location: Location,
  status: S.optional(MutantStatusSchema),
  statusReason: S.optional(S.String),
  coveredBy: S.String.pipe(S.Array, S.optional),
  static: S.optional(S.Boolean),
  testsCompleted: S.optional(S.Finite),
  description: S.optional(S.String),
  subsumption: S.optional(Subsumption),
}).check(
  S.makeFilter(
    (mutant) => mutant.statusReason === undefined || mutant.status !== undefined,
    { message: 'a mutant carries a status reason only together with a status' },
  ),
  S.makeFilter(
    (mutant) => mutant.subsumption === undefined || subsumptionMatchesStatus(mutant.subsumption, mutant.status),
    { message: 'a Subsumed mutant is Ignored, and a Readmitted mutant is not Ignored' },
  ),
)
export type Mutant = typeof Mutant.Type

export const MutantFromUnknown = S.Unknown.pipe(S.decodeTo(Mutant))
export type MutantFromUnknown = typeof MutantFromUnknown.Type

export const RunOptionsFields = {
  timeout: S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0))),
  disableBail: S.Boolean,
}

export const MutantActivationSchema = S.Literals(['runtime', 'static'])
export type MutantActivation = typeof MutantActivationSchema.Type

export const HitCount = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))

export const MutantRunOptionsSchema = S.Struct({
  ...RunOptionsFields,
  activeMutant: Mutant,
  sandboxFileName: S.String,
  mutantActivation: MutantActivationSchema,
  reloadEnvironment: S.Boolean,
  testFilter: S.String.pipe(S.Array, S.optionalKey),
  priorKillerTestIds: S.String.pipe(S.Array, S.optionalKey),
  hitLimit: S.optionalKey(HitCount),
})

const asMutantIdKeyed = (counts: Record<string, number>): Record<MutantId, number> =>
  Object.fromEntries(Object.entries(counts).filter(([key]) => S.is(MutantId)(key)))

const asStringKeyed = (counts: Record<MutantId, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts))

const MutantIdKeyedHitCounts = S.Record(S.String, HitCount).pipe(
  S.check(
    S.makeFilter(
      (counts: Record<string, number>) => {
        const unknownKey = Object.keys(counts).find((key) => !S.is(MutantId)(key))
        return unknownKey === undefined
          ? undefined
          : { path: [unknownKey], issue: `hit counts must be keyed by mutant ids, got '${unknownKey}'` }
      },
      { arbitraryConstraint: { patterns: [{ source: '^[0-9a-f]{16}$', flags: '' }] } },
    ),
  ),
  S.decodeTo(S.Record(MutantId, HitCount), {
    decode: SGetter.transform(asMutantIdKeyed),
    encode: SGetter.transform(asStringKeyed),
  }),
)

export const MutantCoverageSchema = S.Struct({
  perTest: S.Record(S.String, MutantIdKeyedHitCounts),
  static: MutantIdKeyedHitCounts,
})
export type MutantCoverage = typeof MutantCoverageSchema.Type

export type CoverageData = Record<string, number>

export type CoveragePerTestId = Record<string, CoverageData>

export interface Coverage {
  readonly static: CoverageData
  readonly perTest: CoveragePerTestId
}

export interface RunOptions {
  readonly timeout: number
  readonly disableBail: boolean
}

export interface MutantRunOptions extends RunOptions {
  readonly testFilter?: readonly string[]
  readonly priorKillerTestIds?: readonly string[]
  readonly hitLimit?: number
  readonly activeMutant: Mutant
  readonly sandboxFileName: string
  readonly mutantActivation: MutantActivation
  readonly reloadEnvironment: boolean
}

export interface EarlyResultPlan {
  readonly plan: 'EarlyResult'
  readonly mutant: Mutant
}

export interface RunPlan {
  readonly plan: 'Run'
  readonly mutant: Mutant
  readonly runOptions: MutantRunOptions
  readonly netTime: number
}

export type TestPlan = EarlyResultPlan | RunPlan

export type MutantTestCoverage = Mutant & {
  readonly coveredBy: ReadonlyArray<string> | undefined
  readonly static: boolean | undefined
}

export type RunMutantResult = Mutant & {
  readonly status: MutantStatus
  readonly statusReason?: string | undefined
  readonly testsCompleted?: number | undefined
  readonly killedBy?: readonly string[] | undefined
  readonly coveredBy?: readonly string[] | undefined
  readonly static?: boolean | undefined
  readonly cost?: MutantCost | undefined
  readonly remembered?: boolean | undefined
}

export interface MutantCost {
  readonly fixedOverheadMs: number
  readonly testBodyMs: number
  readonly testsExecuted: number
  readonly shared: boolean
}

export type MutantRunPlan = RunPlan

export type MutantEarlyResultPlan = EarlyResultPlan

export type MutantTestPlan = TestPlan

const acceptsMutatorName = (value: string): boolean => S.is(MutatorName)(value)

const isKebabSegment = (segment: string): boolean => /^[a-z0-9]+$/.test(segment)
const startsWithLowerLetter = (value: string): boolean => /^[a-z]/.test(value)

const isKebabNamespace = (namespace: string): boolean =>
  startsWithLowerLetter(namespace) && namespace.split('-').every(isKebabSegment)

const isPascalCase = (name: string): boolean => /^[A-Z]/.test(name) && /^[A-Za-z0-9]*$/.test(name.slice(1))

const namespacePartOf = (parts: ReadonlyArray<string>): string => parts[0] ?? ''
const namePartOf = (parts: ReadonlyArray<string>): string => parts[1] ?? ''

const namespacedPartsReadAsName = (parts: ReadonlyArray<string>): boolean =>
  isKebabNamespace(namespacePartOf(parts)) && isPascalCase(namePartOf(parts))

const readsAsMutatorName = (value: string): boolean => {
  const parts = value.split('/')
  return parts.length === 2 ? namespacedPartsReadAsName(parts) : isPascalCase(value)
}

const namedStatusSubsets: ReadonlyArray<ReadonlyArray<string>> = [
  SurvivorStatusSchema.literals,
  RememberedStatusSchema.literals,
  EphemeralStatusSchema.literals,
  ActionableStatusSchema.literals,
]

const namedByASubset = (status: string): boolean => namedStatusSubsets.some((subset) => subset.includes(status))

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Option = await import('effect/Option')

  const boundaryNames = [
    '',
    'ArithmeticOperator',
    'acme/SwapArguments',
    'acme/',
    '/Swap',
    'a/b/C',
    'arithmeticOperator',
    'acme/swapArguments',
    'a-b/Cd',
  ]
  const withBoundaries = (drawn: string): ReadonlyArray<string> => Arr.prepend(boundaryNames, drawn)

  it.prop(
    '∀n_MutatorNameRefusal_≡ProviderGrammar',
    { of: [S.String], subject: acceptsMutatorName },
    (subject, [drawn]) => Arr.every(withBoundaries(drawn), (value) => subject(value) === readsAsMutatorName(value)),
  )

  const boundaryIds: ReadonlyArray<string> = [
    '',
    '0',
    '1',
    '00',
    '0123456789abcdef',
    '0123456789ABCDEF',
    'fedcba9876543210',
    '0123456789abcde',
    '0123456789abcdef0',
    'g123456789abcdef',
    '-123456789abcdef',
  ]
  const withIdBoundaries = (drawn: string): ReadonlyArray<string> => Arr.prepend(boundaryIds, drawn)
  const readsAsMutantId = (value: string): boolean => /^[0-9a-f]{16}$/.test(value)

  it.prop(
    '∀id_MutantIdRefusal_≡ExactlySixteenLowercaseHexDigits',
    { of: [S.String], subject: (value: string) => S.is(MutantId)(value) },
    (subject, [drawn]) => Arr.every(withIdBoundaries(drawn), (value) => subject(value) === readsAsMutantId(value)),
  )

  const coverageKeyedBy = (key: string): MutantCoverage => ({
    perTest: { 'src/calc.ts::adds': { [key]: 1 } },
    static: { [key]: 1 },
  })
  const decodedCoverageOrNull = (key: string) =>
    Option.getOrNull(S.decodeOption(MutantCoverageSchema)(coverageKeyedBy(key)))

  it.prop(
    '∀key_CoverageKeyRefusal_≡MutantIdKeyedHitCounts',
    { of: [S.String], subject: decodedCoverageOrNull },
    (subject, [drawn]) =>
      Arr.every(withIdBoundaries(drawn), (key) => (subject(key) === null) === !readsAsMutantId(key)),
  )

  const statusProbes = Arr.appendAll([...MutantStatusSchema.literals], ['NotAStatus'])

  it.prop(
    '∀s_NamedStatusSubsets_≡NameExactlyTheStatusVocabulary',
    { of: [S.String], subject: namedByASubset },
    (subject, [drawn]) =>
      Arr.every(statusProbes, (value) => subject(value) === S.is(MutantStatusSchema)(value)) &&
      subject(drawn) === S.is(MutantStatusSchema)(drawn),
  )

  const decodesWith = (subsumption: Subsumption, status: MutantStatus | null): boolean =>
    Option.isSome(
      S.decodeOption(Mutant)({
        _tag: 'Mutant',
        id: '0123456789abcdef',
        fileName: 'src/a.ts',
        mutatorName: 'EqualityOperator',
        replacement: 'a >= b',
        location: { start: { line: 1, column: 1 }, end: { line: 1, column: 6 } },
        subsumption,
        ...(status === null ? {} : { status }),
      }),
    )
  const ACCEPTED_BY_TAG: Readonly<Record<Subsumption['_tag'], ReadonlyArray<MutantStatus | null>>> = {
    Subsumed: ['Ignored'],
    Readmitted: ['Killed', 'Survived', 'NoCoverage', 'CompileError', 'RuntimeError', 'Timeout', 'Pending', null],
  }

  it.prop(
    '∀r,s_SubsumptionRefusal_≡SubsumedOnlyIgnoredReadmittedNeverIgnored',
    { of: [Subsumption, S.NullOr(MutantStatusSchema)], subject: decodesWith },
    (subject, [subsumption, status]) =>
      subject(subsumption, status) === ACCEPTED_BY_TAG[subsumption._tag].includes(status),
  )
}
