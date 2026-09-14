import { afterEach, describe, expect, it } from 'vitest'

import { ancestorsOf, is, isUnknownNode, literal, type NodePath, type PlainIgnorer, struct } from '../src/mod.js'
import { IgnoreTester, type IgnoreTesterCases } from '../src/testing.js'

const STUB_REASON = 'STUB_IGNORED'

const ignoredNode = { type: 'Ignored' }
const keptNode = { type: 'Kept' }
const nestedNode = { type: 'Nested' }
const parentNode = { type: 'Parent' }
const grandparentNode = { type: 'Grandparent' }

const isIgnoredNode = (value: unknown): boolean => is(struct({ type: literal('Ignored') }), value)

const stub: PlainIgnorer = {
  name: 'stub-ignorer',
  shouldIgnore: (path) => (isIgnoredNode(path.node) ? STUB_REASON : undefined),
}

const typeOf = (node: unknown): string => (isUnknownNode(node) ? node.type : '')

const walkReason = (path: NodePath): string => [...ancestorsOf(path)].map(typeOf).join('>')

const walkStub: PlainIgnorer = {
  name: 'walk-stub',
  shouldIgnore: (path) => (isIgnoredNode(path.node) ? walkReason(path) : undefined),
}

const CASES: IgnoreTesterCases = {
  ignored: [
    { name: 'ignores a node the rule names', path: { node: ignoredNode }, reason: STUB_REASON },
    {
      name: 'ignores a node whose parent is kept',
      path: { node: ignoredNode, ancestors: [keptNode, nestedNode] },
      reason: STUB_REASON,
    },
  ],
  kept: [
    { name: 'keeps a node the rule does not name', path: { node: keptNode } },
    { name: 'keeps a node whose parent is ignored', path: { node: keptNode, ancestors: [ignoredNode, nestedNode] } },
    { name: 'keeps a node under an unmodeled ancestor', path: { node: nestedNode, ancestors: [keptNode] } },
  ],
}

const WALK_CASES: IgnoreTesterCases = {
  ignored: [
    {
      name: 'walks the ancestors nearest first',
      path: { node: ignoredNode, ancestors: [parentNode, grandparentNode] },
      reason: 'Parent>Grandparent',
    },
    { name: 'walks nothing for a parentless node', path: { node: ignoredNode }, reason: '' },
  ],
  kept: [],
}

const CASE_NAME = 'a case whose node the declared schema judges'

const rejectedNodeCases: IgnoreTesterCases = {
  ignored: [{ name: CASE_NAME, path: { node: 'not a node' }, reason: STUB_REASON }],
  kept: [],
}

const acceptedNodeCases: IgnoreTesterCases = {
  ignored: [{ name: CASE_NAME, path: { node: ignoredNode }, reason: STUB_REASON }],
  kept: [],
}

interface Registrations {
  readonly suites: string[]
  readonly tests: string[]
}

const runFailure = (ignorer: PlainIgnorer, cases: IgnoreTesterCases): unknown => {
  try {
    IgnoreTester.run(ignorer.name, ignorer, cases)
    return undefined
  } catch (error) {
    return error
  }
}

const wire = (): Registrations => {
  const suites: string[] = []
  const tests: string[] = []
  IgnoreTester.describe = (name, register) => {
    suites.push(name)
    register()
  }
  IgnoreTester.it = (name, assert) => {
    tests.push(name)
    assert()
  }
  IgnoreTester.expect = (value) => ({
    toBe: (expected) => {
      expect(value).toBe(expected)
    },
    toBeUndefined: () => {
      expect(value).toBeUndefined()
    },
  })
  return { suites, tests }
}

describe('IgnoreTester', () => {
  afterEach(() => {
    IgnoreTester.describe = undefined
    IgnoreTester.it = undefined
    IgnoreTester.expect = undefined
  })

  it('refuses to run before a runner is wired', () => {
    expect(() => IgnoreTester.run(stub.name, stub, CASES)).toThrow(
      'IgnoreTester is not wired to a test runner: assign IgnoreTester.describe, .it, and .expect before calling run()',
    )
  })

  it('registers the descriptor and one test per case', () => {
    const { suites, tests } = wire()
    IgnoreTester.run(stub.name, stub, CASES)
    expect(suites).toStrictEqual(['stub-ignorer'])
    expect(tests).toStrictEqual([
      'Should_Register_The_Descriptor',
      'ignores a node the rule names',
      'ignores a node whose parent is kept',
      'keeps a node the rule does not name',
      'keeps a node whose parent is ignored',
      'keeps a node under an unmodeled ancestor',
    ])
    expect(tests).toHaveLength(6)
  })

  it('links the case ancestors into the path the ignorer receives', () => {
    const { tests } = wire()
    IgnoreTester.run(walkStub.name, walkStub, WALK_CASES)
    expect(tests).toHaveLength(3)
  })

  it('fails a case whose node the declared schema rejects', () => {
    wire()
    expect(runFailure(stub, rejectedNodeCases)).toBeInstanceOf(Error)
  })

  it('passes the same case once its node satisfies the declared schema', () => {
    wire()
    expect(runFailure(stub, acceptedNodeCases)).toBeUndefined()
  })
})
