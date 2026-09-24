import type { Ignorer, MemberExpression, MetaProperty, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer } from '@systemfsoftware/stryker-ignorer-kit'

export const IN_SOURCE_TEST_IGNORED =
  'inside an `if (import.meta.vitest)` block — test code, not production behaviour' as const

export const VITEST_META_PROPERTY = 'vitest' as const

const isIdentifierNamed = (node: Node, name: string) => node.type === 'Identifier' && node.name === name

const isNonComputedMember = (node: Node): node is MemberExpression =>
  node.type === 'MemberExpression' && node.computed === false

const isImportMeta = (node: MetaProperty) =>
  isIdentifierNamed(node.meta, 'import') && isIdentifierNamed(node.property, 'meta')

const objectIsImportMeta = (node: MemberExpression) => node.object.type === 'MetaProperty' && isImportMeta(node.object)

const propertyIsVitest = (node: MemberExpression) => isIdentifierNamed(node.property, VITEST_META_PROPERTY)

const isImportMetaVitestMemberShape = (node: MemberExpression) => objectIsImportMeta(node) && propertyIsVitest(node)

const isImportMetaVitestMember = (node: Node) => isNonComputedMember(node) && isImportMetaVitestMemberShape(node)

type BinaryShape = Extract<Node, { readonly type: 'BinaryExpression' }>

const operandIsImportMetaVitest = (node: BinaryShape) =>
  isImportMetaVitestMember(node.left) || isImportMetaVitestMember(node.right)

const isBinaryGuardTest = (node: Node) => node.type === 'BinaryExpression' && operandIsImportMetaVitest(node)

const isGuardTest = (node: Node) => isImportMetaVitestMember(node) || isBinaryGuardTest(node)

const isGuardStatement = (node: Node) => node.type === 'IfStatement' && isGuardTest(node.test)

export const strykerIgnorers: readonly Ignorer[] = [
  defineIgnorer({
    name: 'in-source-vitest-block',
    visitors: {
      IfStatement: (node) => (isGuardTest(node.test) ? IN_SOURCE_TEST_IGNORED : undefined),
      onAnyNode: (_node, ctx) => (ctx.ancestors.some(isGuardStatement) ? IN_SOURCE_TEST_IGNORED : undefined),
    },
  }),
]
