const assert = require('node:assert/strict')

const { calculateTotal, initialStatus } = require('./order.ts')

assert.equal(initialStatus(), 'pending')
assert.equal(calculateTotal(100, 0.1), 110)
