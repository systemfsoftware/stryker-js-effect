import { roundCents } from '@core/pricing'
import { type AggregatedMetric, aggregateMetrics } from '@enterprise/analytics'
import type { InfoMetricEvent, Severity } from '@enterprise/core/contracts'
import type { FeatureConfig } from '@enterprise/core/gates'
import { gateStatus } from '@enterprise/services'
import { type Handler, route } from './dispatch.js'

export interface IncidentRequest {
  readonly severity?: Severity
  readonly note?: string
  readonly config?: FeatureConfig
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const handle = (request: IncidentRequest): Handler | string => {
  // @stryker-expect next-line CompileError(TS2345): ConditionalExpression, EqualityOperator, BlockStatement
  if (request.severity === undefined) {
    return 'rejected: missing severity'
  }
  // @stryker-expect next-line CompileError(TS18048): OptionalChaining
  // @stryker-expect next-line CompileError(TS2345): ConditionalExpression="true" [stryker.checker.config.ts]
  // @stryker-expect next-line Killed: ConditionalExpression="false" [stryker.checker.config.ts]
  // @stryker-expect next-line CompileError(TS2345): ConditionalExpression="true" [stryker.config.ts]
  // @stryker-expect next-line KilledOrTimeout: BooleanLiteral, ConditionalExpression="false", BlockStatement [stryker.config.ts]
  if (!request.config?.enabled) {
    return 'rejected: feature disabled'
  }
  const handler = route(request.severity)
  return `${handler.channel}:${request.note ?? 'none'}`
}

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
// @stryker-expect next-line KilledOrTimeout: ConditionalExpression
// @stryker-expect next-line Survived: EqualityOperator="amount >= ceiling"
// @stryker-expect next-line KilledOrTimeout: EqualityOperator="amount <= ceiling"
export const cap = (amount: number, ceiling: number): number => (amount > ceiling ? ceiling : roundCents(amount))

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
export const statusFor = (config: FeatureConfig | undefined): string => gateStatus(config)

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
export const summarizeHealthMetrics = (
  metrics: ReadonlyArray<InfoMetricEvent>,
): ReadonlyMap<string, AggregatedMetric> => aggregateMetrics(metrics)

// @stryker-expect file KilledOrTimeout: all
