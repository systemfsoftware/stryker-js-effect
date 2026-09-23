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

export const aggregateMetrics = (events: ReadonlyArray<InfoMetricEvent>): ReadonlyMap<string, AggregatedMetric> => {
  const map = new Map<string, { total: number; count: number }>()

  for (const event of events) {
    const existing = map.get(event.name) ?? { total: 0, count: 0 }
    map.set(event.name, {
      total: existing.total + event.value,
      count: existing.count + 1,
    })
  }

  const result = new Map<string, AggregatedMetric>()
  for (const [name, stats] of map.entries()) {
    result.set(name, {
      name,
      total: stats.total,
      count: stats.count,
      average: stats.count > 0 ? stats.total / stats.count : 0,
    })
  }

  return result
}

export const filterCriticalAlerts = (
  events: ReadonlyArray<DomainEvent>,
): ReadonlyArray<ExtractBySeverity<DomainEvent, 'critical'>> =>
  events.filter((e): e is ExtractBySeverity<DomainEvent, 'critical'> => e.severity === 'critical')

export const securityTargetIndex = (alerts: ReadonlyArray<SecurityAlertEvent>): ReadonlyMap<EntityId, string> => {
  const index = new Map<EntityId, string>()
  for (const alert of alerts) {
    index.set(alert.actorId, alert.target)
  }
  return index
}
