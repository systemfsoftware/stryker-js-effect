import { discountFor, type LineItem, lineTotal, roundCents } from './pricing.js'

export class Cart {
  private readonly items: LineItem[] = []
  private memberFlag: boolean = false

  add(item: LineItem): number {
    if (item.quantity > 0 && item.sku !== '') {
      this.items.push(item)
    }
    return this.items.length
  }

  get member(): boolean {
    return this.memberFlag
  }

  set member(value: boolean) {
    this.memberFlag = value
  }

  subtotal(): number {
    let sum = 0
    for (const item of this.items) {
      sum += lineTotal(item)
    }
    return sum
  }

  total(): number {
    const subtotal = this.subtotal()
    return roundCents(subtotal - discountFor(subtotal, this.memberFlag))
  }
}
