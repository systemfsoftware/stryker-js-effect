const assert = require('node:assert/strict')

const { isZero, makeMoney } = require('./core.ts')
const { chargeTax, formatInvoice } = require('./service.ts')

const zero = makeMoney(0, 'USD')
assert.equal(isZero(zero), true)

const net = makeMoney(100, 'USD')
const total = chargeTax(net, 0.2)
assert.equal(total.amount, 120)
assert.equal(total.currency, 'USD')

const usd = makeMoney(42, 'USD')
assert.equal(formatInvoice(usd), '$42.00')
