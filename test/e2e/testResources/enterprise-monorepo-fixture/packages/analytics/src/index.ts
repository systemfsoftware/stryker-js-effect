import type { DomainEvent, EntityId, ExtractBySeverity, InfoMetricEvent, SecurityAlertEvent } from '@enterprise/core'
export type {
  DomainEvent,
  EntityId,
  ExtractBySeverity,
  InfoMetricEvent,
  SecurityAlertEvent,
} from '@enterprise/core/contracts'

export interface AggregatedMetric {
  readonly name: string
  readonly total: number
  readonly count: number
  readonly average: number
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const aggregateMetrics = (events: ReadonlyArray<InfoMetricEvent>): ReadonlyMap<string, AggregatedMetric> => {
  const map = new Map<string, { total: number; count: number }>()

  for (const event of events) {
    // @stryker-expect next-line CompileError(TS18048): LogicalOperator
    // @stryker-expect next-line CompileError(TS2339): ObjectLiteral
    const existing = map.get(event.name) ?? { total: 0, count: 0 }
    // @stryker-expect next-line CompileError(TS2739): ObjectLiteral
    map.set(event.name, {
      total: existing.total + event.value,
      count: existing.count + 1,
    })
  }

  const result = new Map<string, AggregatedMetric>()
  for (const [name, stats] of map.entries()) {
    // @stryker-expect next-line CompileError(TS2739): ObjectLiteral
    result.set(name, {
      name,
      total: stats.total,
      count: stats.count,
      // @stryker-expect next-line Survived: ConditionalExpression="true", EqualityOperator="stats.count >= 0"
      // @stryker-expect next-line KilledOrTimeout: ConditionalExpression="false", EqualityOperator="stats.count <= 0"
      average: stats.count > 0 ? stats.total / stats.count : 0,
    })
  }

  return result
}

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
export const filterCriticalAlerts = (
  events: ReadonlyArray<DomainEvent>,
): ReadonlyArray<ExtractBySeverity<DomainEvent, 'critical'>> =>
  // @stryker-expect next-line CompileError(TS2349): MethodExpression
  // @stryker-expect next-line CompileError(TS2322): ArrowFunction
  // @stryker-expect next-line CompileError(TS2367): StringLiteral
  events.filter((e): e is ExtractBySeverity<DomainEvent, 'critical'> => e.severity === 'critical')

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const securityTargetIndex = (alerts: ReadonlyArray<SecurityAlertEvent>): ReadonlyMap<EntityId, string> => {
  const index = new Map<EntityId, string>()
  for (const alert of alerts) {
    index.set(alert.actorId, alert.target)
  }
  return index
}

// @stryker-expect file KilledOrTimeout: all
