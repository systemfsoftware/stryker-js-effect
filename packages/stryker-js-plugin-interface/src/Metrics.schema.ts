import * as S from 'effect/Schema'

export const DetectedStatus = S.Union([S.Literal('Killed'), S.Literal('Timeout')])
export const UndetectedStatus = S.Union([S.Literal('Survived'), S.Literal('NoCoverage')])
export const InvalidStatus = S.Union([S.Literal('CompileError'), S.Literal('RuntimeError')])
export const UntestedStatus = S.Union([S.Literal('Ignored'), S.Literal('Pending')])

export const NonNegativeInt = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))
export const NonNegativeFinite = S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0)))
export const Percentage = S.Finite.pipe(S.check(S.isBetween({ minimum: 0, maximum: 100 })))

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

  get mutationScore(): number {
    if (this.totalValid === 0) {
      return Number.NaN
    }
    return Math.min(100, Math.max(0, (this.totalDetected / this.totalValid) * 100))
  }

  get mutationScoreBasedOnCoveredCode(): number {
    if (this.totalCovered === 0) {
      return Number.NaN
    }
    return Math.min(100, Math.max(0, (this.totalDetected / this.totalCovered) * 100))
  }

  static fromMutants(mutants: readonly { readonly status: string }[]): Metrics {
    const counts = emptyMetricCounts()
    for (const mutant of mutants) {
      incrementMetricStatus(counts, mutant.status)
    }
    return Metrics.make(counts)
  }
}

interface MetricCounts {
  pending: number
  killed: number
  timeout: number
  survived: number
  noCoverage: number
  runtimeErrors: number
  compileErrors: number
  ignored: number
}

const emptyMetricCounts = (): MetricCounts => ({
  pending: 0,
  killed: 0,
  timeout: 0,
  survived: 0,
  noCoverage: 0,
  runtimeErrors: 0,
  compileErrors: 0,
  ignored: 0,
})

const METRIC_STATUS_KEYS: Partial<Record<string, keyof MetricCounts>> = {
  Pending: 'pending',
  Killed: 'killed',
  Timeout: 'timeout',
  Survived: 'survived',
  NoCoverage: 'noCoverage',
  RuntimeError: 'runtimeErrors',
  CompileError: 'compileErrors',
  Ignored: 'ignored',
}

const incrementMetricStatus = (counts: MetricCounts, status: string): void => {
  const key = METRIC_STATUS_KEYS[status]
  if (key === undefined) {
    return
  }
  counts[key] += 1
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
