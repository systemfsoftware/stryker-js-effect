import { type DomainEvent, entityId, type InfoMetricEvent, type SecurityAlertEvent } from '@enterprise/core'
import { describe, expect, test } from 'vitest'

import { aggregateMetrics, filterCriticalAlerts, securityTargetIndex } from './index.js'

describe.concurrent('Feature: Analytics Metrics Aggregation and Security Filtering', () => {
  describe.concurrent('Rule: Metrics aggregation calculates total, count, and average', () => {
    test('Given metric events, When aggregated, Then computes stats per name', () => {
      const events: ReadonlyArray<InfoMetricEvent> = [
        { type: 'metric', name: 'latency', value: 100, severity: 'info' },
        { type: 'metric', name: 'latency', value: 200, severity: 'info' },
        { type: 'metric', name: 'cpu', value: 50, severity: 'info' },
      ]

      const agg = aggregateMetrics(events)
      expect(agg.get('latency')).toEqual({
        name: 'latency',
        total: 300,
        count: 2,
        average: 150,
      })
      expect(agg.get('cpu')).toEqual({
        name: 'cpu',
        total: 50,
        count: 1,
        average: 50,
      })
    })

    test('Given empty events, When aggregated, Then returns empty map', () => {
      const agg = aggregateMetrics([])
      expect(agg.size).toBe(0)
    })
  })

  describe.concurrent('Rule: Security alerts filter isolates critical events', () => {
    test('Given mixed events, When filtered, Then only critical security alerts remain', () => {
      const alerts: ReadonlyArray<SecurityAlertEvent> = [
        {
          type: 'security_alert',
          actorId: entityId('usr_1'),
          target: 'billing',
          severity: 'critical',
        },
      ]
      const mixed: ReadonlyArray<DomainEvent> = [
        ...alerts,
        { type: 'metric', name: 'm1', value: 1, severity: 'info' },
      ]

      const filtered = filterCriticalAlerts(mixed)
      expect(filtered).toEqual(alerts)
    })
  })

  describe.concurrent('Rule: Security target index maps actorId to target', () => {
    test('Given alerts, When indexed, Then maps correctly', () => {
      const alerts: ReadonlyArray<SecurityAlertEvent> = [
        {
          type: 'security_alert',
          actorId: entityId('usr_1'),
          target: 'vault',
          severity: 'critical',
        },
      ]
      const index = securityTargetIndex(alerts)
      expect(index.get(entityId('usr_1'))).toBe('vault')
    })
  })
})
