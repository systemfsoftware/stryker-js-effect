import { describe, expect, it } from 'vitest'

import { IN_SOURCE_TEST_IGNORED, strykerIgnorers } from '@systemfsoftware/stryker-ignorer-in-source-vitest-block'
import { type PlainIgnorer } from '@systemfsoftware/stryker-ignorer-interface'
import { IgnoreTester, type IgnoreTesterCases } from '@systemfsoftware/stryker-ignorer-interface/testing'

import { binaryOf, guardOf, identifier, importMetaMember, metaOf } from './__fixtures__/InSourceTestAst.fixtures.js'

IgnoreTester.describe = describe
IgnoreTester.it = it
IgnoreTester.expect = expect

const CASES: IgnoreTesterCases = {
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

IgnoreTester.run('in-source-vitest-block', ignorer, CASES)
