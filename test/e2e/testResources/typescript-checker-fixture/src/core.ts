export type Currency = 'USD' | 'EUR'

export interface Money {
  readonly amount: number
  readonly currency: Currency
}

export function makeMoney(amount: number, currency: Currency): Money {
  return { amount, currency }
}

export function isZero(money: Money): boolean {
  return money.amount === 0
}
