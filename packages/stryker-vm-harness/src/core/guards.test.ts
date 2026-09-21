import { describe, expect, it } from 'vitest'
import { guardedExpect, guardedVi } from './guards.js'

describe('guardedExpect', () => {
  it('throws on toMatchSnapshot', () => {
    const proxy = guardedExpect({}) as Record<string, (() => void) | undefined>
    expect(() => proxy['toMatchSnapshot']?.()).toThrow(
      "Snapshot assertions (toMatchSnapshot, toMatchInlineSnapshot) are not supported by the in-memory 'vm' runner.",
    )
  })

  it('throws on toMatchInlineSnapshot', () => {
    const proxy = guardedExpect({}) as Record<string, (() => void) | undefined>
    expect(() => proxy['toMatchInlineSnapshot']?.()).toThrow(
      "Snapshot assertions (toMatchSnapshot, toMatchInlineSnapshot) are not supported by the in-memory 'vm' runner.",
    )
  })

  it('passes through other properties', () => {
    const real = { toBe: (x: unknown) => x }
    const proxy = guardedExpect(real) as typeof real
    expect(proxy.toBe(42)).toBe(42)
  })
})

describe('guardedVi', () => {
  it('throws on mock()', () => {
    const proxy = guardedVi({}) as Record<string, (() => void) | undefined>
    expect(() => proxy['mock']?.()).toThrow(
      "vi.mock is not supported by the in-memory 'vm' runner. Use testRunner: 'vitest' for suites that need module mocking.",
    )
  })

  it('throws on hoisted()', () => {
    const proxy = guardedVi({}) as Record<string, (() => void) | undefined>
    expect(() => proxy['hoisted']?.()).toThrow(
      "vi.hoisted is not supported by the in-memory 'vm' runner. Use testRunner: 'vitest' for suites that need module mocking.",
    )
  })

  it('passes through other properties', () => {
    const fn = () => 'mocked'
    const real = { fn }
    const proxy = guardedVi(real) as typeof real
    expect(proxy.fn()).toBe('mocked')
  })
})
