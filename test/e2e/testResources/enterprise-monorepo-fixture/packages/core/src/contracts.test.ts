import { describe, expect, test } from 'vitest'

import {
  type AuditRecordEvent,
  type DomainEvent,
  entityId,
  type ExtractBySeverity,
  type InfoMetricEvent,
  type RemappedEventHandlers,
  SEVERITIES,
} from './contracts.js'

describe.concurrent('Feature: Core Domain Event Contracts and Metatypes', () => {
  describe.concurrent('Rule: Nominal branded IDs preserve literal value while guaranteeing brand', () => {
    test('Given a raw string, When branded as EntityId, Then preserves value', () => {
      const raw = 'entity-123'
      const branded = entityId(raw)
      expect(branded).toBe('entity-123')
    })
  })

  describe.concurrent('Rule: Severity lookup table provides expected levels', () => {
    test('Given SEVERITIES table, When queried, Then contains info, warning, and critical', () => {
      expect(SEVERITIES.info).toBe('info')
      expect(SEVERITIES.warning).toBe('warning')
      expect(SEVERITIES.critical).toBe('critical')
    })
  })

  describe.concurrent('Rule: Conditional types narrow domain event variants by severity', () => {
    test('Given event types, When filtered via ExtractBySeverity, Then narrows properly', () => {
      type CriticalEvents = ExtractBySeverity<DomainEvent, 'critical'>
      const alert: CriticalEvents = {
        type: 'security_alert',
        actorId: entityId('usr_99'),
        target: 'auth_db',
        severity: 'critical',
      }
      expect(alert.severity).toBe('critical')
      expect(alert.actorId).toBe('usr_99')

      type InfoEvents = ExtractBySeverity<DomainEvent, 'info'>
      const metric: InfoEvents = {
        type: 'metric',
        name: 'cpu_usage',
        value: 42.5,
        severity: 'info',
      }
      expect(metric.value).toBe(42.5)
    })
  })

  describe.concurrent('Rule: Remapped event handlers enforce camelCase handler signature', () => {
    test('Given remapped handler interface, When implemented, Then executes method', () => {
      interface EventMap {
        metric: InfoMetricEvent
        audit: AuditRecordEvent
      }
      const handlers: RemappedEventHandlers<EventMap> = {
        handleMetric: (p) => p.value > 0,
        handleAudit: (p) => p.correlationId.length > 0,
      }
      expect(handlers.handleMetric({ type: 'metric', name: 'ram', value: 10, severity: 'info' })).toBe(true)
      expect(handlers.handleAudit({ type: 'audit', correlationId: 'corr-1', severity: 'warning' })).toBe(true)
    })
  })
})
