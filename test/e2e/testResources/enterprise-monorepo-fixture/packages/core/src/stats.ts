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

export const countVowels = (input: string): number => {
  let count = 0
  for (const ch of input) {
    if (ch === 'a' || ch === 'e' || ch === 'i' || ch === 'o' || ch === 'u') {
      count += 1
    }
  }
  return count
}

export class EventFilter {
  emitted = 0
  skipped = 0
  dropped = 0
  private lastKey: string | undefined

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
    const previous = this.lastKey ?? ''
    this.lastKey = key
    return previous !== key
  }
}
