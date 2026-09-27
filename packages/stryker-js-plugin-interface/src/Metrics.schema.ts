/// <reference types="vitest/importMeta" />
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { type MutantStatus, MutantStatusSchema } from './Mutant.schema.js'

const statusBuckets = {
  Detected: ['Killed', 'Timeout'],
  Undetected: ['Survived', 'NoCoverage'],
  Invalid: ['CompileError', 'RuntimeError'],
  Untested: ['Ignored', 'Pending'],
} as const satisfies Record<string, ReadonlyArray<MutantStatus>>

export const DetectedStatus = S.Literals(statusBuckets.Detected)
export const UndetectedStatus = S.Literals(statusBuckets.Undetected)
export const InvalidStatus = S.Literals(statusBuckets.Invalid)
export const UntestedStatus = S.Literals(statusBuckets.Untested)

export const NonNegativeInt = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))
export const NonNegativeFinite = S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0)))
export const Percentage = S.Finite.pipe(S.check(S.isBetween({ minimum: 0, maximum: 100 })))

export const MutationScore = S.TaggedUnion({
  Scored: { percentage: Percentage },
  Unscored: {},
})
export type MutationScore = typeof MutationScore.Type

const scorePercentageOf = (counts: {
  readonly detected: number
  readonly counted: number
}): Option.Option<number> => counts.counted > 0 ? Option.some((counts.detected / counts.counted) * 100) : Option.none()

export class Metrics extends S.Class<Metrics>('Metrics')({
  pending: NonNegativeInt,
  killed: NonNegativeInt,
  timeout: NonNegativeInt,
  survived: NonNegativeInt,
  noCoverage: NonNegativeInt,
  runtimeErrors: NonNegativeInt,
  compileErrors: NonNegativeInt,
  ignored: NonNegativeInt,
}) {
  get totalDetected(): number {
    return this.timeout + this.killed
  }

  get totalUndetected(): number {
    return this.survived + this.noCoverage
  }

  get totalCovered(): number {
    return this.totalDetected + this.survived
  }

  get totalValid(): number {
    return this.totalUndetected + this.totalDetected
  }

  get totalInvalid(): number {
    return this.runtimeErrors + this.compileErrors
  }

  get totalMutants(): number {
    return this.totalValid + this.totalInvalid + this.ignored + this.pending
  }

  get mutationScore(): MutationScore {
    return Option.match(scorePercentageOf({ detected: this.totalDetected, counted: this.totalValid }), {
      onNone: () => MutationScore.cases.Unscored.make({}),
      onSome: (percentage) => MutationScore.cases.Scored.make({ percentage }),
    })
  }

  get mutationScoreBasedOnCoveredCode(): MutationScore {
    return Option.match(scorePercentageOf({ detected: this.totalDetected, counted: this.totalCovered }), {
      onNone: () => MutationScore.cases.Unscored.make({}),
      onSome: (percentage) => MutationScore.cases.Scored.make({ percentage }),
    })
  }
}

export const MetricsSchema = Metrics

export interface MetricsResult {
  readonly name: string
  readonly metrics: Metrics
  readonly childResults: readonly MetricsResult[]
}

export interface MetricsResultEncoded {
  readonly name: string
  readonly metrics: typeof Metrics.Encoded
  readonly childResults: readonly MetricsResultEncoded[]
}

export const MetricsResultSchema: S.Codec<MetricsResult, MetricsResultEncoded> = S.Struct({
  name: S.String,
  metrics: Metrics,
  childResults: S.Array(S.suspend((): S.Codec<MetricsResult, MetricsResultEncoded> => MetricsResultSchema)),
}).annotate({ identifier: 'MetricsResult' })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Option = await import('effect/Option')

  const statusSubsets: ReadonlyArray<ReadonlyArray<string>> = [
    DetectedStatus.literals,
    UndetectedStatus.literals,
    InvalidStatus.literals,
    UntestedStatus.literals,
  ]
  const bucketCountOf = (status: string): number => statusSubsets.filter((members) => members.includes(status)).length

  const statusProbes = Arr.appendAll([...MutantStatusSchema.literals], ['NotAStatus'])
  const expectedBucketCount = (status: string): number => S.is(MutantStatusSchema)(status) ? 1 : 0

  it.prop(
    '∀s_StatusBuckets_≡ExactlyOneBucketPerStatus',
    { of: [S.String], subject: bucketCountOf },
    (subject, [drawn]) =>
      Arr.every(statusProbes, (value) => subject(value) === expectedBucketCount(value)) &&
      subject(drawn) === expectedBucketCount(drawn),
  )

  it.prop(
    '∀dc_ScorePercentageOf_≡UnscoredIffNothingCounted',
    { of: [NonNegativeInt, NonNegativeInt], subject: scorePercentageOf },
    (subject, [first, second]) => {
      const detected = Math.min(first, second)
      const counted = Math.max(first, second)
      return Option.match(subject({ detected, counted }), {
        onNone: () => counted === 0,
        onSome: (percentage) => counted > 0 && percentage === (detected / counted) * 100,
      })
    },
  )
}
