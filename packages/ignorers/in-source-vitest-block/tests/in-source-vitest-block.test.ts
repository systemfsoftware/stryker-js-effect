import { describe, expect, it } from 'vitest'

import { IN_SOURCE_TEST_IGNORED, strykerIgnorers } from '@systemfsoftware/stryker-ignorer-in-source-vitest-block'
import { testIgnorer } from '@systemfsoftware/stryker-ignorer-kit/tester'

const ignorer = strykerIgnorers[0]
if (ignorer === undefined) {
  throw new Error('@systemfsoftware/stryker-ignorer-in-source-vitest-block exports no ignorer')
}

describe('in-source-vitest-block', () => {
  it('Should_Register_The_Descriptor', () => {
    expect(ignorer.name).toBe('in-source-vitest-block')
  })
})

await testIgnorer(ignorer, {
  ignored: [
    {
      name: 'a bare vitest flag as the guard condition matches',
      code: 'if (import.meta.vitest) { x }',
      ignores: [{ text: 'x', reason: IN_SOURCE_TEST_IGNORED }],
    },
    {
      name: 'a vitest flag on the left side of a comparison matches',
      code: 'if (import.meta.vitest === undefined) { x }',
      ignores: [{ text: 'x', reason: IN_SOURCE_TEST_IGNORED }],
    },
    {
      name: 'a vitest flag on the right side of a comparison matches',
      code: 'if (undefined === import.meta.vitest) { x }',
      ignores: [{ text: 'x', reason: IN_SOURCE_TEST_IGNORED }],
    },
    {
      name: 'a mutant guarded by an ancestor vitest check is ignored',
      code: 'if (import.meta.vitest) { foo(x, a === b, mutant) }',
      ignores: [{ text: 'mutant', reason: IN_SOURCE_TEST_IGNORED }],
    },
    {
      name: 'a guard if statement consulted as the node itself matches',
      code: 'if (import.meta.vitest) x',
      ignores: [{ text: 'if (import.meta.vitest) x', reason: IN_SOURCE_TEST_IGNORED }],
    },
    {
      name: 'a literal whose ancestors carry the guard is ignored',
      code: 'if (import.meta.vitest) { if (import.meta.vitest === undefined) { production } }',
      ignores: [{ text: 'production', reason: IN_SOURCE_TEST_IGNORED }],
    },
    {
      name: 'several spans under one guard are each ignored',
      code: 'if (import.meta.vitest) { foo(a, b) }',
      ignores: ['foo(a, b)', 'a', 'b'],
    },
  ],
  kept: [
    { name: 'a flag for a different meta property does not match', code: 'if (import.meta.env) { x }' },
    { name: 'a vitest flag on a non-import meta does not match', code: 'if (require.meta.vitest) { x }' },
    { name: 'a vitest property on a non-meta object does not match', code: 'if (imports.meta.vitest) { x }' },
    { name: 'a bare vitest expression without an if statement does not match', code: 'import.meta.vitest' },
    { name: 'a plain comparison without a vitest flag does not match', code: 'if (a === b) { x }' },
    { name: 'a mutant with no guard in its ancestors stays live', code: 'if (import.meta.env) { foo(x, mutant) }' },
    { name: 'a mutant with no ancestors at all stays live', code: 'mutant' },
    { name: 'a non-IfStatement parent is not a guard', code: 'const r = import.meta.vitest ? x : y' },
    {
      name: 'a realistic file with no vitest guard keeps everything live',
      code: 'export function add(a: number, b: number): number {\n  return a + b\n}',
    },
  ],
})
