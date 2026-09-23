export interface RetryOptions {
  readonly attempts?: number
  readonly backoffMs?: number
}

export interface RetryPlan {
  readonly attempts: number
  readonly backoffMs: number
}

export const retryPlan = ({ attempts = 3, backoffMs = 25 }: RetryOptions = {}): RetryPlan => ({
  attempts,
  backoffMs,
})

export const countRiskSignals = (signals: readonly string[]): number => {
  let score = 0
  for (const signal of signals) {
    if (
      signal === 'tor' ||
      signal === 'vpn' ||
      signal === 'proxy' ||
      signal === 'suspicious' ||
      signal === 'flagged'
    ) {
      score += 1
    }
  }
  return score
}

export class EventFilter {
  emitted = 0
  skipped = 0
  dropped = 0

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
    this.emitted += 1
    return true
  }
}
