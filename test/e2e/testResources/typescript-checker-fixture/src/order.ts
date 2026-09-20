export type OrderStatus = 'pending' | 'completed' | 'cancelled'

export function initialStatus(): OrderStatus {
  return 'pending'
}

export function calculateTotal(amount: number, taxRate: number): number {
  return amount + amount * taxRate
}

export function formatId(id: string): string {
  return `ORDER-${id}`
}
