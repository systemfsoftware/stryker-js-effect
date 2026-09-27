export interface StockClient {
  level(sku: string): Promise<number>
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const restock = async (client: StockClient, sku: string, threshold: number): Promise<number> => {
  const level = await client.level(sku)
  // Stryker disable ConditionalExpression: the threshold comparison is exercised by the shortfall tests
  // @stryker-expect next-line Ignored: ConditionalExpression
  // @stryker-expect next-line Survived: EqualityOperator="level >= threshold" [stryker.config.ts]
  // @stryker-expect next-line KilledOrTimeout: EqualityOperator="level <= threshold" [stryker.config.ts]
  // @stryker-expect next-line Ignored: EqualityOperator [stryker.edge.config.ts]
  if (level > threshold) {
    return 0
  }
  return threshold - level
}

export interface AuditEntry {
  readonly event: string
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const loadAuditLog = async (): Promise<readonly AuditEntry[]> => {
  // Static import would bypass the loading boundary this fixture exercises (R4).
  // @stryker-expect next-line CompileError(TS2307): StringLiteral
  const module = await import('./audit-log.js')
  // @stryker-expect next-line CompileError(TS2322): ArrowFunction, ObjectLiteral
  return module.AUDIT_LOG.map((event) => ({ event }))
}

// @stryker-expect file KilledOrTimeout: all
