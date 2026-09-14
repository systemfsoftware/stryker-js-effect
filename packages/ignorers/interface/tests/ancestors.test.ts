import { describe, expect, it } from 'vitest'

import { ancestorsOf, type NodePath } from '../src/mod.js'

const root: NodePath = { node: 'the file root', parentPath: null }
const grandparent: NodePath = { node: 'grandparent', parentPath: root }
const parent: NodePath = { node: 'parent', parentPath: grandparent }

describe('ancestorsOf', () => {
  it('yields a three-level chain from the nearest ancestor to the root', () => {
    expect([...ancestorsOf({ node: 'the mutant', parentPath: parent })]).toStrictEqual([
      'parent',
      'grandparent',
      'the file root',
    ])
  })

  it('yields nothing for a parent stated as null', () => {
    expect([...ancestorsOf(root)]).toStrictEqual([])
  })

  it('yields nothing for an absent parent', () => {
    expect([...ancestorsOf({ node: 'the mutant' })]).toStrictEqual([])
  })

  it('yields a node carrying extra host properties', () => {
    const hostParent = { node: 'the enclosing node', parentPath: null, isObjectExpression: () => false }
    expect([...ancestorsOf({ node: 'the mutant', parentPath: hostParent })]).toStrictEqual(['the enclosing node'])
  })
})
