import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer, type IgnorerContext, type IgnorerVisitors } from '@systemfsoftware/stryker-ignorer-kit'
import { describe, it } from '@systemfsoftware/vitest'

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
    if (captured === undefined) {
      throw new Error('visitor never consulted')
    }
    return captured
  }
  return { ignorer, seen }
}

describe('defineIgnorer', () => {
  it.each(dispatchRows)('$name', function*(row, { expect }) {
    const ignorer = defineIgnorer({ name: 't', visitors: row.visitors })
    yield* expect(ignorer.shouldIgnore(row.node, [])).toBe(row.expected)
  })

  it('context accessors narrow the parent, search the chain, and expose it by reference', function*({ expect }) {
    const call = callExpression(identifier('f'), [])
    const guard = ifStatement(call, identifier('body'))
    const chain: Node[] = [call, guard]
    const { ignorer, seen } = contextRecorder()
    ignorer.shouldIgnore(stringLiteral('x'), chain)
    const ctx = seen()
    yield* expect({
      parentCall: ctx.parentIf('CallExpression'),
      parentStatement: ctx.parentIf('IfStatement'),
      ancestorIf: ctx.ancestorIf('IfStatement'),
      ancestorProgram: ctx.ancestorIf('Program'),
      ancestors: ctx.ancestors,
    }).toEqual({
      parentCall: call,
      parentStatement: undefined,
      ancestorIf: guard,
      ancestorProgram: undefined,
      ancestors: chain,
    })
  })

  it('ancestorIf returns the nearest matching chain member', function*({ expect }) {
    const near = callExpression(identifier('near'), [])
    const far = callExpression(identifier('far'), [])
    const { ignorer, seen } = contextRecorder()
    ignorer.shouldIgnore(stringLiteral('x'), [near, far])
    yield* expect(seen().ancestorIf('CallExpression')).toBe(near)
  })

  it('compiles to the wire shape', function*({ expect }) {
    const ignorer = defineIgnorer({ name: 't', visitors: { Literal: () => 'R' } })
    yield* expect({ name: ignorer.name, reason: ignorer.shouldIgnore(stringLiteral('x'), []) }).toEqual({
      name: 't',
      reason: 'R',
    })
  })
})
