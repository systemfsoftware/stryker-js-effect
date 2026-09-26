/// <reference types="vitest/importMeta" />
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const DetectedStatus = S.Union([S.Literal('Killed'), S.Literal('Timeout')])
export const UndetectedStatus = S.Union([S.Literal('Survived'), S.Literal('NoCoverage')])
export const InvalidStatus = S.Union([S.Literal('CompileError'), S.Literal('RuntimeError')])
export const UntestedStatus = S.Union([S.Literal('Ignored'), S.Literal('Pending')])

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
  const Option = await import('effect/Option')

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
