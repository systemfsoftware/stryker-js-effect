import type { Ignorer, MemberExpression, MetaProperty, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer } from '@systemfsoftware/stryker-ignorer-kit'

export const IN_SOURCE_TEST_IGNORED =
  'inside an `if (import.meta.vitest)` block — test code, not production behaviour' as const

export const VITEST_META_PROPERTY = 'vitest' as const

function isIdentifierNamed(node: Node, name: string): boolean {
  return node.type === 'Identifier' && node.name === name
}

function isNonComputedMember(node: Node): node is MemberExpression {
  return node.type === 'MemberExpression' && node.computed === false
}

function isImportMeta(node: MetaProperty): boolean {
  return isIdentifierNamed(node.meta, 'import') && isIdentifierNamed(node.property, 'meta')
}

function objectIsImportMeta(node: MemberExpression): boolean {
  return node.object.type === 'MetaProperty' && isImportMeta(node.object)
}

function propertyIsVitest(node: MemberExpression): boolean {
  return isIdentifierNamed(node.property, VITEST_META_PROPERTY)
}

function isImportMetaVitestMemberShape(node: MemberExpression): boolean {
  return objectIsImportMeta(node) && propertyIsVitest(node)
}

function isImportMetaVitestMember(node: Node): boolean {
  return isNonComputedMember(node) && isImportMetaVitestMemberShape(node)
}

type BinaryShape = Extract<Node, { readonly type: 'BinaryExpression' }>

function operandIsImportMetaVitest(node: BinaryShape): boolean {
  return isImportMetaVitestMember(node.left) || isImportMetaVitestMember(node.right)
}

function isBinaryGuardTest(node: Node): boolean {
  return node.type === 'BinaryExpression' && operandIsImportMetaVitest(node)
}

function isGuardTest(node: Node): boolean {
  return isImportMetaVitestMember(node) || isBinaryGuardTest(node)
}

function isGuardStatement(node: Node): boolean {
  return node.type === 'IfStatement' && isGuardTest(node.test)
}

export const strykerIgnorers: readonly Ignorer[] = [
  defineIgnorer({
    name: 'in-source-vitest-block',
    visitors: {
      IfStatement: (node) => (isGuardTest(node.test) ? IN_SOURCE_TEST_IGNORED : undefined),
      onAnyNode: (_node, ctx) => (ctx.ancestors.some(isGuardStatement) ? IN_SOURCE_TEST_IGNORED : undefined),
    },
  }),
]
