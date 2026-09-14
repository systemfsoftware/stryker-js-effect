import { describe, expect, it } from 'vitest'

import { IN_SOURCE_TEST_IGNORED, strykerIgnorers } from '@systemfsoftware/stryker-ignorer-in-source-vitest-block'
import { type NodePath, type PlainIgnorer } from '@systemfsoftware/stryker-ignorer-interface'

import { binaryOf, guardOf, identifier, importMetaMember, metaOf } from './__fixtures__/InSourceTestAst.fixtures.js'

const CASES = {
  ignored: [
    {
      name: 'A bare vitest flag as the guard condition matches',
      path: { node: identifier('x'), ancestors: [guardOf(importMetaMember('vitest'))] },
      reason: IN_SOURCE_TEST_IGNORED,
    },
    {
      name: 'A vitest flag on the left side of a comparison matches',
      path: {
        node: identifier('x'),
        ancestors: [guardOf(binaryOf(importMetaMember('vitest'), identifier('undefined')))],
      },
      reason: IN_SOURCE_TEST_IGNORED,
    },
    {
      name: 'A vitest flag on the right side of a comparison matches',
      path: {
        node: identifier('x'),
        ancestors: [guardOf(binaryOf(identifier('undefined'), importMetaMember('vitest')))],
      },
      reason: IN_SOURCE_TEST_IGNORED,
    },
    {
      name: 'A mutant guarded by an ancestor vitest check is ignored',
      path: {
        node: identifier('mutant'),
        ancestors: [identifier('x'), binaryOf(identifier('a'), identifier('b')), guardOf(importMetaMember('vitest'))],
      },
      reason: IN_SOURCE_TEST_IGNORED,
    },
    {
      name:
        'The exported descriptor registers under the in-source-vitest-block name and answers like the decision function',
      path: { node: identifier('x'), ancestors: [guardOf(importMetaMember('vitest'))] },
      reason: IN_SOURCE_TEST_IGNORED,
    },
  ],
  kept: [
    {
      name: 'A flag for a different meta property does not match',
      path: { node: identifier('x'), ancestors: [guardOf(importMetaMember('env'))] },
    },
    {
      name: 'A vitest flag on a non-import meta does not match',
      path: {
        node: identifier('x'),
        ancestors: [
          guardOf({ type: 'MemberExpression', object: metaOf('require', 'meta'), property: identifier('vitest') }),
        ],
      },
    },
    {
      name: 'A vitest property on a non-meta object does not match',
      path: {
        node: identifier('x'),
        ancestors: [
          guardOf({ type: 'MemberExpression', object: metaOf('import', 'cache'), property: identifier('vitest') }),
        ],
      },
    },
    {
      name: 'A bare vitest expression without an if statement does not match',
      path: { node: importMetaMember('vitest') },
    },
    {
      name: 'A plain comparison without a vitest flag does not match',
      path: { node: identifier('x'), ancestors: [guardOf(binaryOf(identifier('a'), identifier('b')))] },
    },
    {
      name: 'A mutant with no guard in its ancestors stays live',
      path: { node: identifier('mutant'), ancestors: [identifier('x'), guardOf(importMetaMember('env'))] },
    },
    {
      name: 'A mutant with no ancestors at all stays live',
      path: { node: identifier('mutant') },
    },
    {
      name: 'A non-IfStatement parent is not a guard',
      path: { node: identifier('x'), ancestors: [importMetaMember('vitest')] },
    },
  ],
}

const ignorer: PlainIgnorer | undefined = strykerIgnorers[0]
if (ignorer === undefined) throw new Error('@systemfsoftware/stryker-ignorer-in-source-vitest-block exports no ignorer')

interface CasePath {
  readonly node: unknown
  readonly ancestors?: readonly unknown[] | undefined
}

const pathOf = (spec: CasePath): NodePath => ({ node: spec.node, ancestors: spec.ancestors ?? [] })

describe('in-source-vitest-block', () => {
  it('Should_Register_The_Descriptor', () => {
    expect(ignorer.name).toBe('in-source-vitest-block')
  })
  it.each(CASES.ignored)('ignores: $name', (testCase) => {
    expect(ignorer.shouldIgnore(pathOf(testCase.path))).toBe(testCase.reason)
  })
  it.each(CASES.kept)('keeps: $name', (testCase) => {
    expect(ignorer.shouldIgnore(pathOf(testCase.path))).toBeUndefined()
  })
  it('ignores a literal whose ancestors carry the guard', () => {
    expect(
      ignorer.shouldIgnore({
        node: { type: 'Literal', value: 'production' },
        ancestors: [
          binaryOf(importMetaMember('vitest'), identifier('undefined')),
          guardOf(importMetaMember('vitest')),
        ],
      }),
    ).toBe(IN_SOURCE_TEST_IGNORED)
  })
})
