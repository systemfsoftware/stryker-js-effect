import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

import { LocationSchema } from './Location.schema.js'

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

export const MutantId = S.NonEmptyString.pipe(S.brand('MutantId'))
export type MutantId = typeof MutantId.Type

export const MutatorName = S.NonEmptyString.pipe(S.brand('MutatorName'))
export type MutatorName = typeof MutatorName.Type

export const CanonicalFileName = S.String.pipe(
  S.decodeTo(S.String.pipe(S.check(S.isPattern(/^[^\\]*$/)), S.brand('CanonicalFileName')), {
    decode: SGetter.transform((fileName) => fileName.replace(/\\/g, '/')),
    encode: SGetter.transform((canonical) => canonical),
  }),
)
export type CanonicalFileName = typeof CanonicalFileName.Type
export class Mutant extends S.TaggedClass<Mutant>()('Mutant', {
  id: MutantId,
  fileName: CanonicalFileName,
  mutatorName: MutatorName,
  replacement: S.String,
  location: LocationSchema,
  status: S.optional(MutantStatusSchema),
  statusReason: S.optional(S.String),
  coveredBy: S.String.pipe(S.Array, S.optional),
  static: S.optional(S.Boolean),
  testsCompleted: S.optional(S.Finite),
  description: S.optional(S.String),
}) {}

export const MutantFromUnknown = S.Unknown.pipe(S.decodeTo(Mutant))
export type MutantFromUnknown = typeof MutantFromUnknown.Type

export const RunOptionsFields = {
  timeout: S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0))),
  disableBail: S.Boolean,
}

export const MutantActivationSchema = S.Literals(['runtime', 'static'])
export type MutantActivation = typeof MutantActivationSchema.Type

export const MutantRunOptionsSchema = S.Struct({
  ...RunOptionsFields,
  activeMutant: Mutant,
  sandboxFileName: S.String,
  mutantActivation: MutantActivationSchema,
  reloadEnvironment: S.Boolean,
  testFilter: S.String.pipe(S.Array, S.optionalKey),
  hitLimit: S.optionalKey(S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))),
})

export const MutantCoverageSchema = S.Struct({
  perTest: S.Record(S.String, S.Record(S.String, S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0))))),
  static: S.Record(S.String, S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))),
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
}

export class InstrumenterContext extends S.Class<InstrumenterContext>('InstrumenterContext')({
  activeMutant: S.optional(S.String),
  currentTestId: S.optional(S.String),
  mutantCoverage: S.optional(MutantCoverageSchema),
  hitCount: S.optional(S.Finite),
  hitLimit: S.optional(S.Finite),
}) {
  static readonly NAMESPACE = '__stryker__'
  static readonly MUTATION_COVERAGE_OBJECT = 'mutantCoverage'
  static readonly ACTIVE_MUTANT = 'activeMutant'
  static readonly CURRENT_TEST_ID = 'currentTestId'
  static readonly HIT_COUNT = 'hitCount'
  static readonly HIT_LIMIT = 'hitLimit'
  static readonly ACTIVE_MUTANT_ENV_VARIABLE = '__STRYKER_ACTIVE_MUTANT__'
}

export type MutantRunPlan = RunPlan

export type MutantEarlyResultPlan = EarlyResultPlan

export type MutantTestPlan = TestPlan

export class MutantNotApplied
  extends S.TaggedError<MutantNotApplied>('@systemfsoftware/stryker-js-instrumenter/Mutant.schema/MutantNotApplied')(
    'MutantNotApplied',
    { replacement: S.String },
  )
{
  override get message(): string {
    return `Could not apply mutant ${this.replacement}.`
  }
}

export class MutantSpanMissing
  extends S.TaggedError<MutantSpanMissing>('@systemfsoftware/stryker-js-instrumenter/Mutant.schema/MutantSpanMissing')(
    'MutantSpanMissing',
    { edge: S.Literals(['start', 'end']) },
  )
{
  override get message(): string {
    return `Node without a ${this.edge} offset`
  }
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Schema } = await import('effect')

  it.prop('∀path_CanonicalFileName_≡BackslashToSlash', [Schema.String], ([path]) =>
    Option.match(S.decodeOption(CanonicalFileName)(path), {
      onNone: () => path.includes('\\'),
      onSome: (canonical) => canonical === path.replace(/\\/g, '/'),
    }),
  )

  it.prop('∀path_CanonicalFileName_∘CanonicalEncodeIdentity', [Schema.String], ([path]) =>
    Option.match(S.decodeOption(CanonicalFileName)(path), {
      onNone: () => path.includes('\\'),
      onSome: (canonical) =>
        Option.match(S.encodeOption(CanonicalFileName)(canonical), {
          onNone: () => false,
          onSome: (back) => back === canonical,
        }),
    }),
  )
}
