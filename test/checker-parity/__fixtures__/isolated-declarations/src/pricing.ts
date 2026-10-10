export interface LineItem {
  readonly sku: string
  readonly unitPrice: number
  readonly quantity: number
}

export function lineTotal(item: LineItem): number {
  if (item.quantity <= 0) {
    return 0
  }
  return item.unitPrice * item.quantity
}

export function discountFor(total: number, member: boolean): number {
  if (member && total > 100) {
    return total * 0.1
  }
  return total >= 50 ? 5 : 0
}

export const roundCents = (value: number): number => Math.round(value * 100) / 100
