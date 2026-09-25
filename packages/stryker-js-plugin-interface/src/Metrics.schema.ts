import * as Boolean from 'effect/Boolean'
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
    return scoreOf(this.totalDetected, this.totalValid)
  }

  get mutationScoreBasedOnCoveredCode(): MutationScore {
    return scoreOf(this.totalDetected, this.totalCovered)
  }

  static fromMutants(mutants: readonly { readonly status: string }[]): Metrics {
    return Metrics.make({
      pending: metricCountOf(mutants, 'Pending'),
      killed: metricCountOf(mutants, 'Killed'),
      timeout: metricCountOf(mutants, 'Timeout'),
      survived: metricCountOf(mutants, 'Survived'),
      noCoverage: metricCountOf(mutants, 'NoCoverage'),
      runtimeErrors: metricCountOf(mutants, 'RuntimeError'),
      compileErrors: metricCountOf(mutants, 'CompileError'),
      ignored: metricCountOf(mutants, 'Ignored'),
    })
  }
}

const metricCountOf = (mutants: readonly { readonly status: string }[], status: string) =>
  mutants.filter((mutant) => mutant.status === status).length

const scoreOf = (detected: number, counted: number): MutationScore =>
  Boolean.match(counted > 0, {
    onTrue: () => MutationScore.cases.Scored.make({ percentage: (detected / counted) * 100 }),
    onFalse: () => MutationScore.cases.Unscored.make({}),
  })

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

  it.prop(
    '∀dc_MutationScore_≡UnscoredIffNothingCounted',
    { of: [NonNegativeInt, NonNegativeInt], subject: scoreOf },
    (subject, [first, second]) => {
      const detected = Math.min(first, second)
      const counted = Math.max(first, second)
      return MutationScore.match(subject(detected, counted), {
        Unscored: () => counted === 0,
        Scored: ({ percentage }) => counted > 0 && percentage === (detected / counted) * 100,
      })
    },
  )
}
