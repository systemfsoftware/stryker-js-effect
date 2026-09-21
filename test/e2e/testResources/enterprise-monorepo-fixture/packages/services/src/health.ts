import { isLaunchable } from '@enterprise/core'
import type { FeatureConfig } from '@enterprise/core'
import { sleep } from './clock.js'

export interface ProbeOptions {
  readonly attempts?: number
  readonly delayMs?: number
}

export interface ProbeResult {
  readonly healthy: boolean
  readonly attemptsUsed: number
}

export const probe = async (check: () => Promise<boolean>, options: ProbeOptions = {}): Promise<ProbeResult> => {
  const attempts = options.attempts ?? 2
  const delayMs = options.delayMs ?? 5
  const sequence = Array.from({ length: attempts }, (_unused, index) => index + 1)
  for (const attempt of sequence) {
    if (await check()) {
      return { healthy: true, attemptsUsed: attempt }
    }
    if (attempt < attempts) {
      await sleep(delayMs)
    }
  }
  return { healthy: false, attemptsUsed: attempts }
}

export const gateStatus = (config: FeatureConfig | undefined): string => {
  if (!config?.enabled) {
    return 'off'
  }
  return config.canaryPercent > 0 ? 'partial' : 'steady'
}

export const launchState = (config: FeatureConfig): string => (isLaunchable(config) ? 'launching' : 'holding')
