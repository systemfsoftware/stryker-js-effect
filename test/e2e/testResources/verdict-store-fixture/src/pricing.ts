export function subtotal(prices: readonly number[]): number {
  return prices.reduce((total, price) => total + price, 0)
}

export function discounted(price: number, percent: number): number {
  return price - (price * percent) / 100
}

export function withTax(price: number, rate: number): number {
  return price + price * rate
}

export function isFree(price: number): boolean {
  return price <= 0
}

export function isBulk(quantity: number): boolean {
  return quantity >= 10
}

export function shippingFor(weight: number): number {
  if (weight > 20) {
    return 15
  }
  if (weight > 5) {
    return 8
  }
  return 3
}

export function label(price: number): string {
  return price > 100 ? 'premium' : 'standard'
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}
