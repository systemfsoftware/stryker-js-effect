import type {
  BinaryExpression,
  IdentifierName,
  IfStatement,
  MemberExpression,
  MetaProperty,
  Node,
} from '@systemfsoftware/stryker-ignorer-interface'

export const IN_SOURCE_TEST_IGNORED =
  'inside an `if (import.meta.vitest)` block — test code, not production behaviour' as const

export const VITEST_META_PROPERTY = 'vitest' as const

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const hasStringType = (value: object): value is Node => 'type' in value && typeof value.type === 'string'

const isAstLike = (value: unknown): value is Node => isObject(value) && hasStringType(value)

const isNodeOfType = (value: unknown, type: Node['type']): value is Node => isAstLike(value) && value.type === type

const hasStringName = (value: Node): boolean => 'name' in value && typeof value.name === 'string'

export const isIdentifierName = (value: unknown): value is IdentifierName =>
  isNodeOfType(value, 'Identifier') && hasStringName(value)

const isNamed = (value: unknown, name: string): value is IdentifierName =>
  isIdentifierName(value) && value.name === name

const hasMetaIdentifier = (value: Node): boolean => 'meta' in value && isIdentifierName(value.meta)

const hasPropertyIdentifier = (value: Node): boolean => 'property' in value && isIdentifierName(value.property)

const hasIdentifierPair = (value: Node): boolean => hasMetaIdentifier(value) && hasPropertyIdentifier(value)

const isMetaProperty = (value: unknown): value is MetaProperty =>
  isNodeOfType(value, 'MetaProperty') && hasIdentifierPair(value)

const hasObjectMetaProperty = (value: Node): boolean => 'object' in value && isMetaProperty(value.object)

const hasImportMetaPair = (value: Node): boolean => hasObjectMetaProperty(value) && hasPropertyIdentifier(value)

export const isImportMetaMember = (value: unknown): value is MemberExpression =>
  isNodeOfType(value, 'MemberExpression') && hasImportMetaPair(value)

const hasLeftAst = (value: Node): boolean => 'left' in value && isAstLike(value.left)

const hasRightAst = (value: Node): boolean => 'right' in value && isAstLike(value.right)

const hasBinaryOperands = (value: Node): boolean => hasLeftAst(value) && hasRightAst(value)

export const isBinaryExpression = (value: unknown): value is BinaryExpression =>
  isNodeOfType(value, 'BinaryExpression') && hasBinaryOperands(value)

const hasTestAst = (value: Node): boolean => 'test' in value && isAstLike(value.test)

export const isIfStatement = (value: unknown): value is IfStatement =>
  isNodeOfType(value, 'IfStatement') && hasTestAst(value)

const isImportMetaObject = (node: MetaProperty): boolean =>
  isNamed(node.meta, 'import') && isNamed(node.property, 'meta')

const hasImportMetaObject = (node: MemberExpression): boolean =>
  isMetaProperty(node.object) && isImportMetaObject(node.object)

const hasVitestProperty = (node: MemberExpression): boolean => isNamed(node.property, VITEST_META_PROPERTY)

const hasImportMetaVitest = (node: MemberExpression): boolean => hasImportMetaObject(node) && hasVitestProperty(node)

const isImportMetaVitest = (node: unknown): boolean => isImportMetaMember(node) && hasImportMetaVitest(node)

const hasImportMetaVitestOperand = (test: BinaryExpression): boolean =>
  isImportMetaVitest(test.left) || isImportMetaVitest(test.right)

const isBinaryImportMetaVitest = (test: unknown): boolean =>
  isBinaryExpression(test) && hasImportMetaVitestOperand(test)

const guardsOnImportMetaVitest = (test: unknown): boolean => isImportMetaVitest(test) || isBinaryImportMetaVitest(test)

export const isInSourceTestGuard = (node: unknown): boolean =>
  isIfStatement(node) && guardsOnImportMetaVitest(node.test)

const carriesInSourceTestGuard = (node: Node, ancestors: readonly Node[]): boolean =>
  isInSourceTestGuard(node) || ancestors.some(isInSourceTestGuard)

export const decideInSourceTestIgnore = (node: Node, ancestors: readonly Node[]): string | undefined =>
  carriesInSourceTestGuard(node, ancestors) ? IN_SOURCE_TEST_IGNORED : undefined
