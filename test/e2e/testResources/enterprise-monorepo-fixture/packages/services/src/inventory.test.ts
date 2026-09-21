import { afterEach, describe, expect, test, vi } from 'vitest'

import { loadAuditLog, restock, type StockClient } from './inventory.js'

describe('restock', () => {
  const client: StockClient = {
    async level(sku: string): Promise<number> {
      return sku === 'sku-low' ? 2 : 40
    },
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('orders nothing above the threshold', async () => {
    await expect(restock(client, 'sku-high', 10)).resolves.toBe(0)
  })

  test('orders the shortfall at or below the threshold', async () => {
    await expect(restock(client, 'sku-low', 25)).resolves.toBe(23)
    await expect(restock(client, 'sku-low', 2)).resolves.toBe(0)
  })

  test('queries exactly the requested sku', async () => {
    const spy = vi.spyOn(client, 'level')
    await restock(client, 'sku-low', 25)
    expect(spy).toHaveBeenCalledExactlyOnceWith('sku-low')
  })
})

describe('loadAuditLog', () => {
  test('lazily loads the audit module once per environment', async () => {
    await expect(loadAuditLog()).resolves.toEqual([{ event: 'boot' }, { event: 'ready' }])
    await expect(loadAuditLog()).resolves.toEqual([{ event: 'boot' }, { event: 'ready' }])
  })
})
