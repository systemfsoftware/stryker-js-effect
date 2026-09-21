export interface StockClient {
  level(sku: string): Promise<number>
}

export const restock = async (client: StockClient, sku: string, threshold: number): Promise<number> => {
  const level = await client.level(sku)
  if (level > threshold) {
    return 0
  }
  return threshold - level
}

export interface AuditEntry {
  readonly event: string
}

export const loadAuditLog = async (): Promise<readonly AuditEntry[]> => {
  // Static import would bypass the loading boundary this fixture exercises (R4).
  const module = await import('./audit-log.js')
  return module.AUDIT_LOG.map((event) => ({ event }))
}
