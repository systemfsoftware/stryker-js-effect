import { it } from '@effect/vitest'
import { FastCheck as fc } from 'effect/testing'

import { ancestorsOf, type NodePath } from '../mod.js'

const chains = fc
  .array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 20 })
  .map((ids) => ids.map((id) => ({ kind: 'node', id })))

const pathOfChain = (chain: ReadonlyArray<{ kind: string; id: number }>): NodePath => {
  let path: NodePath = { node: 'the file root', parentPath: null }
  for (let index = chain.length - 1; index >= 0; index--) {
    path = { node: chain[index], parentPath: path }
  }
  return path
}

it.prop('∀c_Chain_=tail+root', [chains], ([chain]) => {
  const yielded = [...ancestorsOf(pathOfChain(chain))]
  const expected = [...chain.slice(1), 'the file root']
  return yielded.length === expected.length && yielded.every((node, index) => node === expected[index])
})
