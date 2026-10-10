import { Cart } from './cart.js'

export function receiptLine(label: string, amount: number): string {
  const padded = label.length > 20 ? label.slice(0, 20) : label.padEnd(20, '.')
  return `${padded} ${amount.toFixed(2)}`
}

export function receiptFor(cart: Cart): string {
  const lines = [receiptLine('Subtotal', cart.subtotal())]
  if (cart.member) {
    lines.push(receiptLine('Member', cart.subtotal() - cart.total()))
  }
  lines.push(receiptLine('Total', cart.total()))
  return lines.join('\n')
}
