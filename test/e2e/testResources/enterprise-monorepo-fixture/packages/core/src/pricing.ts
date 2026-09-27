export interface PriceInput {
  readonly unitPrice: number
  readonly quantity: number
  readonly discountRate: number
  readonly taxRate: number
}

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
export const roundCents = (amount: number): number => Math.round(amount * 100) / 100

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
export const subtotal = (input: PriceInput): number => input.unitPrice * input.quantity

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
export const discount = (input: PriceInput): number => roundCents(subtotal(input) * input.discountRate)

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const total = (input: PriceInput): number => {
  const base = subtotal(input) - discount(input)
  if (!Number.isFinite(base)) {
    return 0
  }
  return roundCents(base + base * input.taxRate)
}

export interface VolumeRebateInput {
  readonly quantity: number
  readonly baseAmount: number
  readonly isPrivilegedAccount?: boolean
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const applyVolumeRebate = (input: VolumeRebateInput): number => {
  // @stryker-expect next-line KilledOrTimeout: ConditionalExpression="true", EqualityOperator="input.quantity > 0"
  // @stryker-expect next-line Survived: ConditionalExpression="false", EqualityOperator="input.quantity < 0"
  // @stryker-expect next-line Survived: BlockStatement="{}"
  if (input.quantity <= 0) {
    return input.baseAmount
  }
  let rebateRate = 0
  if (input.quantity >= 1000) {
    rebateRate = 0.25
  } else if (input.quantity >= 500) {
    rebateRate = 0.15
  } else if (input.quantity >= 100) {
    rebateRate = 0.05
  }

  if (input.isPrivilegedAccount && input.quantity > 50) {
    rebateRate += 0.05
  }

  return roundCents(input.baseAmount * (1 - rebateRate))
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export function refund(amount: number): number {
  return -roundCents(amount)
}

// @stryker-expect file KilledOrTimeout: all
