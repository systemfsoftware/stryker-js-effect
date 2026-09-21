import { describe, expect, it } from 'vitest'

import { add, double, isPositive } from './calc.js'

describe('math', () => {
  it('adds its two operands', () => {
    expect(add(2, 3)).toBe(5)
  })

  it('separates a positive number from zero', () => {
    expect(isPositive(0)).toBe(false)
    expect(isPositive(1)).toBe(true)
  })

  it('calls double without pinning it', () => {
    expect(() => double(3)).not.toThrow()
  })
})
