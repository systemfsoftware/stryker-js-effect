import { afterEach, describe, expect, test, vi } from 'vitest'

import { loadAuditLog, restock, type StockClient } from './inventory.js'

describe('Feature: Inventory Stock Allocation & Dynamic Audit Log Ingestion', () => {
  const client: StockClient = {
    async level(sku: string): Promise<number> {
      return sku === 'sku-low' ? 2 : 40
    },
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Rule: Restocking computes the exact shortfall required to meet minimum thresholds', () => {
    test('Given inventory levels exceeding the threshold, When evaluating restock needs, Then zero additional units are ordered', async () => {
      await expect(restock(client, 'sku-high', 10)).resolves.toBe(0)
    })

    test('Given inventory levels at or below the threshold, When evaluating restock needs, Then it orders the exact shortfall', async () => {
      await expect(restock(client, 'sku-low', 25)).resolves.toBe(23)
      await expect(restock(client, 'sku-low', 2)).resolves.toBe(0)
    })

    test('Given a restock query, When checking stock levels, Then it queries the designated SKU from the external client', async () => {
      const spy = vi.spyOn(client, 'level')
      await restock(client, 'sku-low', 25)
      expect(spy).toHaveBeenCalledExactlyOnceWith('sku-low')
    })
  })

  describe('Rule: Dynamic audit logging module is loaded asynchronously without breaking runtime isolation', () => {
    test('Given a request for audit log entries, When loaded via dynamic import, Then it returns the initialized audit trail', async () => {
      await expect(loadAuditLog()).resolves.toEqual([{ event: 'boot' }, { event: 'ready' }])
      await expect(loadAuditLog()).resolves.toEqual([{ event: 'boot' }, { event: 'ready' }])
    })
  })
})
