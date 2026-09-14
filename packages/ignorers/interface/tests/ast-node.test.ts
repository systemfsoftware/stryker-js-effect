import { describe, expect, it } from 'vitest'

import {
  AstNode,
  is,
  isArrowFunctionExpression,
  isBinaryExpression,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isImportDeclaration,
  isImportNamespaceSpecifier,
  isImportSpecifier,
  isMemberExpression,
  isMetaProperty,
  isObjectExpression,
  isProgram,
  isProperty,
  isStringLiteral,
  isUnknownNode,
  NodePathSchema,
} from '../src/mod.js'

interface KindFixture {
  readonly name: string
  readonly fixture: unknown
  readonly sibling: unknown
  readonly holds: (value: unknown) => boolean
}

const identifier = { type: 'Identifier', name: 'kept' }
const stringLiteral = { type: 'Literal', value: 'kept' }

const VOCABULARY: readonly KindFixture[] = [
  { name: 'Identifier', fixture: identifier, sibling: stringLiteral, holds: isIdentifier },
  { name: 'StringLiteral', fixture: stringLiteral, sibling: identifier, holds: isStringLiteral },
  {
    name: 'ObjectExpression',
    fixture: { type: 'ObjectExpression' },
    sibling: { type: 'Property' },
    holds: isObjectExpression,
  },
  { name: 'Property', fixture: { type: 'Property' }, sibling: { type: 'ObjectExpression' }, holds: isProperty },
  {
    name: 'ArrowFunctionExpression',
    fixture: { type: 'ArrowFunctionExpression' },
    sibling: { type: 'FunctionExpression' },
    holds: isArrowFunctionExpression,
  },
  {
    name: 'FunctionExpression',
    fixture: { type: 'FunctionExpression' },
    sibling: { type: 'ArrowFunctionExpression' },
    holds: isFunctionExpression,
  },
  {
    name: 'MemberExpression',
    fixture: { type: 'MemberExpression', object: identifier, property: identifier },
    sibling: { type: 'CallExpression', callee: identifier, arguments: [] },
    holds: isMemberExpression,
  },
  {
    name: 'CallExpression',
    fixture: { type: 'CallExpression', callee: identifier, arguments: [] },
    sibling: { type: 'MemberExpression', object: identifier, property: identifier },
    holds: isCallExpression,
  },
  {
    name: 'MetaProperty',
    fixture: { type: 'MetaProperty', meta: identifier, property: identifier },
    sibling: { type: 'MemberExpression', object: identifier, property: identifier },
    holds: isMetaProperty,
  },
  {
    name: 'BinaryExpression',
    fixture: { type: 'BinaryExpression', left: identifier, right: identifier },
    sibling: { type: 'IfStatement', test: identifier },
    holds: isBinaryExpression,
  },
  {
    name: 'IfStatement',
    fixture: { type: 'IfStatement', test: identifier },
    sibling: { type: 'BinaryExpression', left: identifier, right: identifier },
    holds: isIfStatement,
  },
  {
    name: 'ImportSpecifier',
    fixture: { type: 'ImportSpecifier', imported: identifier, local: identifier },
    sibling: { type: 'ImportNamespaceSpecifier', local: identifier },
    holds: isImportSpecifier,
  },
  {
    name: 'ImportNamespaceSpecifier',
    fixture: { type: 'ImportNamespaceSpecifier', local: identifier },
    sibling: { type: 'ImportSpecifier', imported: identifier, local: identifier },
    holds: isImportNamespaceSpecifier,
  },
  {
    name: 'ImportDeclaration',
    fixture: {
      type: 'ImportDeclaration',
      source: stringLiteral,
      specifiers: [{ type: 'ImportSpecifier', imported: identifier, local: identifier }],
    },
    sibling: { type: 'Program', body: [] },
    holds: isImportDeclaration,
  },
  { name: 'Program', fixture: { type: 'Program', body: [] }, sibling: { type: 'ImportDeclaration' }, holds: isProgram },
  { name: 'UnknownNode', fixture: { type: 'Anything' }, sibling: {}, holds: isUnknownNode },
]

const MEMBER_NODE: unknown = {
  type: 'MemberExpression',
  object: { type: 'Identifier', name: 'kept' },
  property: { type: 'Identifier', name: 'name' },
}

const nestedMembers = (nodes: number): unknown => {
  let node: unknown = { type: 'Identifier', name: 'root' }
  for (let level = 1; level < nodes; level += 1) {
    node = { type: 'MemberExpression', object: node, property: { type: 'Identifier', name: 'name' } }
  }
  return node
}

describe('the canonical vocabulary', () => {
  VOCABULARY.forEach((kind) => {
    it(`accepts ${kind.name}`, () => {
      expect(kind.holds(kind.fixture)).toBe(true)
    })

    it(`rejects a sibling of ${kind.name}`, () => {
      expect(kind.holds(kind.sibling)).toBe(false)
    })
  })
})

describe('the composite kinds', () => {
  it('MemberExpression rejects a node missing its property', () => {
    expect(isMemberExpression({ type: 'MemberExpression', object: identifier })).toBe(false)
  })

  it('MemberExpression rejects an object outside the vocabulary', () => {
    expect(isMemberExpression({ type: 'MemberExpression', object: 'kept', property: identifier })).toBe(false)
  })

  it('CallExpression accepts any expression in an argument slot', () => {
    expect(isCallExpression({ type: 'CallExpression', callee: identifier, arguments: [identifier, 1, 'kept'] })).toBe(
      true,
    )
  })

  it('MetaProperty rejects an identifier meta of the wrong kind', () => {
    expect(isMetaProperty({ type: 'MetaProperty', meta: 'import', property: identifier })).toBe(false)
  })

  it('BinaryExpression rejects a node missing its right side', () => {
    expect(isBinaryExpression({ type: 'BinaryExpression', left: identifier })).toBe(false)
  })

  it('IfStatement rejects a node missing its test', () => {
    expect(isIfStatement({ type: 'IfStatement' })).toBe(false)
  })

  it('StringLiteral rejects a literal without a string value', () => {
    expect(isStringLiteral({ type: 'Literal' })).toBe(false)
  })

  it('ImportDeclaration accepts a namespace specifier', () => {
    expect(
      isImportDeclaration({
        type: 'ImportDeclaration',
        source: stringLiteral,
        specifiers: [{ type: 'ImportNamespaceSpecifier', local: identifier }],
      }),
    ).toBe(true)
  })

  it('ImportDeclaration rejects a specifier outside the admitted kinds', () => {
    expect(
      isImportDeclaration({ type: 'ImportDeclaration', source: stringLiteral, specifiers: [identifier] }),
    ).toBe(false)
  })

  it('Program accepts a body of unmodeled statements', () => {
    expect(isProgram({ type: 'Program', body: [{ type: 'Anything' }, 1] })).toBe(true)
  })
})

describe('AstNode', () => {
  it('accepts an unmodeled node type', () => {
    expect(is(AstNode, { type: 'Anything' })).toBe(true)
  })

  it('rejects an object carrying no type', () => {
    expect(is(AstNode, {})).toBe(false)
  })

  it('rejects a bare string', () => {
    expect(is(AstNode, 'not a node')).toBe(false)
  })

  it('accepts a composite node typed against the union', () => {
    expect(is(AstNode, MEMBER_NODE)).toBe(true)
  })

  it('accepts a chain at the recursion budget', () => {
    expect(is(AstNode, nestedMembers(6))).toBe(true)
  })

  it('resolves a chain past the recursion budget to the catch-all kind', () => {
    expect(is(AstNode, nestedMembers(7))).toBe(true)
  })
})

describe('NodePathSchema', () => {
  it('accepts a null parent', () => {
    expect(is(NodePathSchema, { node: identifier, parentPath: null })).toBe(true)
  })

  it('accepts an absent parent', () => {
    expect(is(NodePathSchema, { node: identifier })).toBe(true)
  })

  it('accepts a two-level chain', () => {
    expect(is(NodePathSchema, { node: identifier, parentPath: { node: stringLiteral, parentPath: null } })).toBe(true)
  })

  it('rejects a node outside the vocabulary', () => {
    expect(is(NodePathSchema, { node: 'not a node' })).toBe(false)
  })
})
