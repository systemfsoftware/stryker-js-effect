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

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const probe = async (check: () => Promise<boolean>, options: ProbeOptions = {}): Promise<ProbeResult> => {
  // @stryker-expect next-line CompileError(TS2322): LogicalOperator
  const attempts = options.attempts ?? 2
  // @stryker-expect next-line CompileError(TS2345): LogicalOperator
  const delayMs = options.delayMs ?? 5
  // @stryker-expect next-line CompileError(TS2322): ObjectLiteral, ArrowFunction
  const sequence = Array.from({ length: attempts }, (_unused, index) => index + 1)
  for (const attempt of sequence) {
    if (await check()) {
      // @stryker-expect next-line CompileError(TS2739): ObjectLiteral
      return { healthy: true, attemptsUsed: attempt }
    }
    await sleep(delayMs)
  }
  // @stryker-expect next-line CompileError(TS2739): ObjectLiteral
  return { healthy: false, attemptsUsed: attempts }
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const gateStatus = (config: FeatureConfig | undefined): string => {
  // @stryker-expect next-line CompileError(TS18048): BooleanLiteral, ConditionalExpression, OptionalChaining, BlockStatement
  if (!config?.enabled) {
    return 'off'
  }
  return config.canaryPercent > 0 ? 'partial' : 'steady'
}

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
export const launchState = (config: FeatureConfig): string => (isLaunchable(config) ? 'launching' : 'holding')

// @stryker-expect file KilledOrTimeout: all
