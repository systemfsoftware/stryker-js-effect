import { describe, expect, test } from 'vitest'

import { AUDIT_LOG, collectAuditEvents, streamAuditEvents } from './audit-log.js'

describe('Feature: System Boot and Audit Trail Verification', () => {
  describe('Rule: The audit log preserves an immutable sequence of initialization events', () => {
    test('Given the default audit logging log entries, When inspected, Then it reflects the ordered boot and ready sequence', () => {
      expect([...AUDIT_LOG]).toEqual(['boot', 'ready'])
    })
  })

  describe('Rule: Asynchronous audit event stream yields formatted actor records with destructuring defaults', () => {
    test('yields formatted strings with default actor details when undefined', async () => {
      const events = await collectAuditEvents([
        { event: 'login' },
        { event: 'checkout', actor: { id: 'usr_123', role: 'admin' } },
        { event: 'logout', actor: { id: 'usr_456' } },
      ])
      expect(events).toEqual([
        'login:anonymous:guest',
        'checkout:usr_123:admin',
        'logout:usr_456:guest',
      ])
    })

    test('directly iterates async generator streamAuditEvents', async () => {
      const chunks: string[] = []
      for await (const chunk of streamAuditEvents([{ event: 'ping' }])) {
        chunks.push(chunk)
      }
      expect(chunks).toEqual(['ping:anonymous:guest'])
    })
  })
})
