import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer, type IgnorerContext, type IgnorerVisitors } from '@systemfsoftware/stryker-ignorer-kit'
import { describe, expect, it } from 'vitest'

import { callExpression, identifier, ifStatement, stringLiteral } from './fixtures/nodes.js'

interface DispatchRow {
  readonly name: string
  readonly node: Node
  readonly visitors: IgnorerVisitors
  readonly expected: string | undefined
}

const dispatchRows: DispatchRow[] = [
  {
    name: 'a typed visitor claiming its node returns its reason',
    node: stringLiteral('x'),
    visitors: { Literal: () => 'R' },
    expected: 'R',
  },
  {
    name: 'a typed visitor declining falls through to onAnyNode',
    node: stringLiteral('x'),
    visitors: { Literal: () => undefined, onAnyNode: () => 'A' },
    expected: 'A',
  },
  {
    name: 'a typed visitor claiming prevents onAnyNode',
    node: stringLiteral('x'),
    visitors: { Literal: () => 'R', onAnyNode: () => 'A' },
    expected: 'R',
  },
  {
    name: 'a node kind with no typed visitor reaches an onAnyNode that claims it',
    node: identifier('n'),
    visitors: { onAnyNode: (one) => (one.type === 'Identifier' ? 'A' : undefined) },
    expected: 'A',
  },
  {
    name: 'a node kind with no typed visitor and a declining onAnyNode stays live',
    node: identifier('n'),
    visitors: { onAnyNode: (one) => (one.type === 'Literal' ? 'A' : undefined) },
    expected: undefined,
  },
  {
    name: 'a typed visitor declining with no onAnyNode stays live',
    node: stringLiteral('x'),
    visitors: { Literal: () => undefined },
    expected: undefined,
  },
]

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
  it.each(dispatchRows)('$name', (row) => {
    const ignorer = defineIgnorer({ name: 't', visitors: row.visitors })
    expect(ignorer.shouldIgnore(row.node, [])).toBe(row.expected)
  })

  it('context accessors narrow the parent, search the chain, and expose it by reference', () => {
    const call = callExpression(identifier('f'), [])
    const guard = ifStatement(call, identifier('body'))
    const chain: Node[] = [call, guard]
    const { ignorer, seen } = contextRecorder()
    ignorer.shouldIgnore(stringLiteral('x'), chain)
    const ctx = seen()
    expect(ctx.parentIf('CallExpression')).toBe(call)
    expect(ctx.parentIf('IfStatement')).toBeUndefined()
    expect(ctx.ancestorIf('IfStatement')).toBe(guard)
    expect(ctx.ancestorIf('Program')).toBeUndefined()
    expect(ctx.ancestors).toBe(chain)
  })

  it('ancestorIf returns the nearest matching chain member', () => {
    const near = callExpression(identifier('near'), [])
    const far = callExpression(identifier('far'), [])
    const { ignorer, seen } = contextRecorder()
    ignorer.shouldIgnore(stringLiteral('x'), [near, far])
    expect(seen().ancestorIf('CallExpression')).toBe(near)
  })

  it('compiles to the wire shape', () => {
    const ignorer = defineIgnorer({ name: 't', visitors: { Literal: () => 'R' } })
    expect(ignorer.name).toBe('t')
    expect(ignorer.shouldIgnore(stringLiteral('x'), [])).toBe('R')
  })
})
