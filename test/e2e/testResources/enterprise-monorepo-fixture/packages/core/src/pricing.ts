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
