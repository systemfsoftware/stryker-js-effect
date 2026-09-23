import { describe, expect, test } from 'vitest'

import type { InfoMetricEvent } from '@enterprise/core'
import { cap, handle, statusFor, summarizeHealthMetrics } from './report.js'

const activeCanaryConfig = { enabled: true, canaryPercent: 10 }

describe.concurrent('Feature: API Incident Orchestration & Financial Capping', () => {
  describe.concurrent('Rule: Incident dispatch requires enabled feature configuration and valid severity', () => {
    test.each([
      {
        request: { severity: 'critical' as const, note: 'disk full', config: activeCanaryConfig },
        expected: 'pager:disk full',
        description: 'valid critical severity with custom note',
      },
      {
        request: { severity: 'info' as const, config: activeCanaryConfig },
        expected: 'log:none',
        description: 'valid severity without custom note defaulting to none',
      },
      {
        request: { config: activeCanaryConfig },
        expected: 'rejected: missing severity',
        description: 'incident missing severity classification',
      },
      {
        request: { severity: 'warning' as const, config: { enabled: false, canaryPercent: 10 } },
        expected: 'rejected: feature disabled',
        description: 'disabled feature configuration',
      },
      {
        request: { severity: 'warning' as const },
        expected: 'rejected: feature disabled',
        description: 'completely absent configuration',
      },
    ])('Given $description, When handled, Then it resolves to $expected', ({ request, expected }) => {
      expect(handle(request)).toBe(expected)
    })
  })

  describe.concurrent('Rule: Financial amount capping rounds and clamps values to maximum ceilings', () => {
    test.each([
      { amount: 3.456, ceiling: 5, expected: 3.46, description: 'amount below ceiling rounding half up' },
      { amount: 6, ceiling: 5, expected: 5, description: 'amount exceeding ceiling clamped to ceiling' },
      { amount: 5, ceiling: 5, expected: 5, description: 'amount exactly equal to ceiling preserved' },
    ])('Given $description, When capped, Then cap returns $expected', ({ amount, ceiling, expected }) => {
      expect(cap(amount, ceiling)).toBe(expected)
    })
  })

  describe.concurrent('Rule: Status checks delegate across composite package boundaries to services', () => {
    test.each([
      { config: activeCanaryConfig, expected: 'partial', description: 'active partial canary configuration' },
      { config: undefined, expected: 'off', description: 'absent configuration defaulting to off' },
    ])('Given $description, When status is resolved, Then statusFor returns $expected', ({ config, expected }) => {
      expect(statusFor(config)).toBe(expected)
    })
  })

  describe.concurrent('Rule: End-to-end cross-package orchestration across api, services, and core', () => {
    test('Given an incident request with an active feature configuration, When processed through the orchestration pipeline, Then it integrates api routing, service health gates, and core launch contracts', () => {
      const fullRolloutConfig = { enabled: true, canaryPercent: 100, region: 'us-east' }
      const status = statusFor(fullRolloutConfig)
      expect(status).toBe('partial')

      const result = handle({ severity: 'critical', note: 'security audit alert', config: fullRolloutConfig })
      expect(result).toBe('pager:security audit alert')
    })
  })

  describe.concurrent('Rule: Health metrics aggregation summarizes domain info telemetry via analytics', () => {
    test('Given metrics list, When summarized via analytics layer, Then returns mapped aggregates', () => {
      const metrics: ReadonlyArray<InfoMetricEvent> = [
        { type: 'metric', name: 'rps', value: 50, severity: 'info' },
        { type: 'metric', name: 'rps', value: 150, severity: 'info' },
      ]
      const summary = summarizeHealthMetrics(metrics)
      expect(summary.get('rps')?.average).toBe(100)
      expect(summary.get('rps')?.total).toBe(200)
    })
  })
})
