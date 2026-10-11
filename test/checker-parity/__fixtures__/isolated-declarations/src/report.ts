import type { LineItem } from './pricing.js'

export async function loadFormatter(): Promise<(items: readonly LineItem[]) => string> {
  const receipt = await import('./receipt.js')
  return (items) => items.map((item) => receipt.receiptLine(item.sku, item.unitPrice * item.quantity)).join('\n')
}

export function countBySku(items: readonly LineItem[], sku: string): number {
  return items.filter((item) => item.sku === sku && item.quantity > 0).length
}
