export type OrderStatus = 'pending' | 'completed' | 'cancelled'

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export function initialStatus(): OrderStatus {
  // @stryker-expect next-line CompileError(TS2322): StringLiteral
  return 'pending'
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export function calculateTotal(amount: number, taxRate: number): number {
  // @stryker-expect next-line Killed: ArithmeticOperator
  return amount + amount * taxRate
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export function formatId(id: string): string {
  // @stryker-expect next-line NoCoverage: StringLiteral
  return `ORDER-${id}`
}
