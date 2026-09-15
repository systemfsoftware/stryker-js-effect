import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer, type IgnorerContext } from '@systemfsoftware/stryker-ignorer-kit'
import { describe, expect, it } from 'vitest'

function isTestNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
}

function node(type: string, extra: Record<string, unknown> = {}): Node {
  const candidate: unknown = { type, start: 0, end: 0, ...extra }
  if (!isTestNode(candidate)) throw new Error(`bad test node: ${type}`)
  return candidate
}

const stringX = (): Node => node('Literal', { value: 'x' })

interface Recorder {
  readonly ignorer: Ignorer
  readonly seen: () => IgnorerContext
}

function contextRecorder(): Recorder {
  let captured: IgnorerContext | undefined
  const ignorer = defineIgnorer({
    name: 't',
    visitors: {
      Literal: (_one, ctx) => {
        captured = ctx
        return 'R'
      },
    },
  })
  const seen = (): IgnorerContext => {
    if (captured === undefined) throw new Error('visitor never consulted')
    return captured
  }
  return { ignorer, seen }
}

describe('defineIgnorer', () => {
  it('hands a typed visitor the node it was keyed for and returns its reason', () => {
    const ignorer = defineIgnorer({
      name: 't',
      visitors: { Literal: (one) => (one.value === 'x' ? 'R' : undefined) },
    })
    expect(ignorer.shouldIgnore(stringX(), [])).toBe('R')
  })

  it('falls through to onAnyNode when the typed visitor declines', () => {
    const ignorer = defineIgnorer({
      name: 't',
      visitors: {
        Literal: () => undefined,
        onAnyNode: () => 'A',
      },
    })
    expect(ignorer.shouldIgnore(stringX(), [])).toBe('A')
  })

  it('hands a node kind with no typed visitor to onAnyNode', () => {
    const ignorer = defineIgnorer({
      name: 't',
      visitors: { onAnyNode: (one) => (one.type === 'Identifier' ? 'A' : undefined) },
    })
    expect(ignorer.shouldIgnore(node('Identifier', { name: 'n' }), [])).toBe('A')
    expect(ignorer.shouldIgnore(stringX(), [])).toBeUndefined()
  })

  it('a typed visitor claiming the node prevents onAnyNode', () => {
    const ignorer = defineIgnorer({
      name: 't',
      visitors: {
        Literal: () => 'R',
        onAnyNode: () => 'A',
      },
    })
    expect(ignorer.shouldIgnore(stringX(), [])).toBe('R')
  })

  it('context accessors narrow the chain and expose it raw', () => {
    const call = node('CallExpression', { arguments: [], callee: node('Identifier', { name: 'f' }) })
    const ifStatement = node('IfStatement', { test: call })
    const { ignorer, seen } = contextRecorder()
    const chain = [ifStatement, call]
    ignorer.shouldIgnore(stringX(), chain)
    const ctx = seen()
    expect(ctx.parentIf('CallExpression')).toBe(call)
    expect(ctx.parentIf('IfStatement')).toBeUndefined()
    expect(ctx.ancestorIf('IfStatement')).toBe(ifStatement)
    expect(ctx.ancestorIf('Program')).toBeUndefined()
    expect(ctx.ancestors).toBe(chain)
  })

  it('ancestorIf returns the nearest matching chain member', () => {
    const near = node('CallExpression', { arguments: [], callee: node('Identifier', { name: 'near' }) })
    const far = node('CallExpression', { arguments: [], callee: node('Identifier', { name: 'far' }) })
    const { ignorer, seen } = contextRecorder()
    ignorer.shouldIgnore(stringX(), [far, near])
    expect(seen().ancestorIf('CallExpression')).toBe(near)
  })

  it('compiles to the wire shape', () => {
    const ignorer = defineIgnorer({ name: 't', visitors: {} })
    expect(typeof ignorer.name).toBe('string')
    expect(ignorer.name).toBe('t')
    expect(typeof ignorer.shouldIgnore).toBe('function')
  })

  it('passes the ancestor chain through unmodified, root-first, excluding the node', () => {
    const parent = node('CallExpression', { arguments: [], callee: node('Identifier', { name: 'f' }) })
    const { ignorer, seen } = contextRecorder()
    const chain = [parent]
    ignorer.shouldIgnore(stringX(), chain)
    expect(seen().ancestors).toBe(chain)
  })
})
