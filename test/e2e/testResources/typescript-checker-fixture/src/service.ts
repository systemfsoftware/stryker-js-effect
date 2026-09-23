import { makeMoney, type Money } from './core.js'

export function chargeTax(net: Money, rate: number): Money {
  if (rate < 0) {
    throw new Error('Negative tax rate')
  }
  const tax = net.amount * rate
  return makeMoney(net.amount + tax, net.currency)
}

export function formatInvoice(money: Money): string {
  const symbol = money.currency === 'USD' ? '$' : '€'
  return `${symbol}${money.amount.toFixed(2)}`
}
