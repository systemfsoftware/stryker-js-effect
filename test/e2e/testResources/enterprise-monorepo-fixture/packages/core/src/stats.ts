export interface RetryOptions {
  readonly attempts?: number
  readonly backoffMs?: number
}

export interface RetryPlan {
  readonly attempts: number
  readonly backoffMs: number
}

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
// @stryker-expect next-line CompileError(TS2739): ObjectLiteral
export const retryPlan = ({ attempts = 3, backoffMs = 25 }: RetryOptions = {}): RetryPlan => ({ attempts, backoffMs })

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const countRiskSignals = (signals: readonly string[]): number => {
  let score = 0
  for (const signal of signals) {
    if (
      // @stryker-expect next-line CompileError(TS2367): LogicalOperator, EqualityOperator
      signal === 'tor' ||
      // @stryker-expect next-line CompileError(TS2367): EqualityOperator
      signal === 'vpn' ||
      // @stryker-expect next-line CompileError(TS2367): EqualityOperator
      signal === 'proxy' ||
      // @stryker-expect next-line CompileError(TS2367): EqualityOperator
      signal === 'suspicious' ||
      signal === 'flagged'
    ) {
      score += 1
    }
  }
  return score
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export function isRiskCode(signal: string): boolean {
  return /^risk-[0-9]+$/.test(signal)
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export function riskTags(): ReadonlyArray<string> {
  return [
    // @stryker-expect next-line KilledOrTimeout: StringLiteral, guards/FlipRiskTag
    'block',
    // @stryker-expect next-line Survived: StringLiteral
    'review',
  ]
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export function primaryTag(): string {
  const tags = riskTags()
  return tags[0].toUpperCase()
}

// @stryker-expect next-line NoCoverage: all
export function legacyRiskScore(signals: readonly string[]): number {
  let total = 0
  // @stryker-expect next-line NoCoverage: BlockStatement="{}"
  for (const signal of signals) {
    // @stryker-expect next-line NoCoverage: all
    if (signal === 'legacy') {
      // @stryker-expect next-line NoCoverage: all
      total += 1
    }
  }
  return total
}

export class EventFilter {
  emitted = 0
  skipped = 0
  dropped = 0

  // @stryker-expect next-line CompileError(TS2355): BlockStatement
  shouldEmit(key: string, registry: Readonly<Record<string, boolean>>): boolean {
    const flagged = registry[key]
    if (flagged === undefined) {
      this.skipped++
      return false
    }
    if (!flagged) {
      this.skipped++
      this.dropped++
      return false
    }
    this.emitted++
    return true
  }
}

// @stryker-expect file KilledOrTimeout: all
