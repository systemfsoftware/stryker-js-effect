import { describe, expect, it } from 'vitest'

import { greeting } from '../src/nested.js'

describe('greeting', () => {
  describe('inside a nested suite', () => {
    it('returns the greeting', () => {
      expect(greeting()).toBe('hello')
    })
  })
})

describe.each(['friend', 'stranger'])('greeting a %s', () => {
  it('returns the greeting', () => {
    expect(greeting()).toBe('hello')
  })
})
