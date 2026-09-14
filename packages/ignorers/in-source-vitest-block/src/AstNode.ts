import type { Identifier } from '@systemfsoftware/stryker-ignorer-interface'

export type { Identifier }

export interface AstLike {
  readonly type: string
  readonly [key: string]: unknown
}

export interface MetaProperty {
  readonly type: 'MetaProperty'
  readonly meta: Identifier
  readonly property: Identifier
}

export interface ImportMetaMember {
  readonly type: 'MemberExpression'
  readonly object: MetaProperty
  readonly property: Identifier
}

export interface BinaryExpression {
  readonly type: 'BinaryExpression'
  readonly left: AstLike
  readonly right: AstLike
}

export interface IfStatement {
  readonly type: 'IfStatement'
  readonly test: AstLike
}

export type AstNodeType = Identifier | MetaProperty | ImportMetaMember | BinaryExpression | IfStatement | AstLike

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const hasStringType = (value: object): boolean => 'type' in value && typeof value.type === 'string'

const isAstLike = (value: unknown): value is AstLike => isObject(value) && hasStringType(value)

const isNodeOfType = (value: unknown, type: string): value is AstLike => isAstLike(value) && value.type === type

const isIdentifier = (value: unknown): value is Identifier =>
  isNodeOfType(value, 'Identifier') && typeof value['name'] === 'string'

const hasIdentifierPair = (value: AstLike, first: string, second: string): boolean =>
  isIdentifier(value[first]) && isIdentifier(value[second])

const isMetaProperty = (value: unknown): value is MetaProperty =>
  isNodeOfType(value, 'MetaProperty') && hasIdentifierPair(value, 'meta', 'property')

const hasImportMetaPair = (value: AstLike): boolean =>
  isMetaProperty(value['object']) && isIdentifier(value['property'])

export const isImportMetaMember = (value: unknown): value is ImportMetaMember =>
  isNodeOfType(value, 'MemberExpression') && hasImportMetaPair(value)

const hasBinarySides = (value: AstLike): boolean => isAstLike(value['left']) && isAstLike(value['right'])

export const isBinaryExpression = (value: unknown): value is BinaryExpression =>
  isNodeOfType(value, 'BinaryExpression') && hasBinarySides(value)

export const isIfStatement = (value: unknown): value is IfStatement =>
  isNodeOfType(value, 'IfStatement') && isAstLike(value['test'])
