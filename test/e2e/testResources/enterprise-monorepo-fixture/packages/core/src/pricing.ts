export interface PriceInput {
  readonly unitPrice: number
  readonly quantity: number
  readonly discountRate: number
  readonly taxRate: number
}

export const roundCents = (amount: number): number => Math.round(amount * 100) / 100

export const subtotal = (input: PriceInput): number => input.unitPrice * input.quantity

export const discount = (input: PriceInput): number => roundCents(subtotal(input) * input.discountRate)

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

export const applyVolumeRebate = (input: VolumeRebateInput): number => {
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
