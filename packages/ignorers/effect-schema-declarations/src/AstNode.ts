import type {
  ArrowFunctionExpression,
  Identifier,
  MemberExpression,
  ObjectExpression,
  StringLiteral,
  UnknownNode,
} from '@systemfsoftware/stryker-ignorer-interface'

export type { ArrowFunctionExpression, Identifier, MemberExpression, ObjectExpression, StringLiteral, UnknownNode }

/**
 * Strict — unlike the interface's loose `CallExpression` — because the decision indexes
 * `arguments` to prove a position is a declaration slot.
 */
export interface CallExpression {
  readonly type: 'CallExpression'
  readonly callee: AstNode
  readonly arguments: ReadonlyArray<AstNode>
}

export type AstNode =
  | Identifier
  | StringLiteral
  | ObjectExpression
  | ArrowFunctionExpression
  | MemberExpression
  | CallExpression
  | UnknownNode

export type DocumentationKey = 'identifier' | 'description' | 'title' | 'documentation' | 'examples'

export type DocumentationKeyNode =
  | { readonly type: 'Identifier'; readonly name: DocumentationKey }
  | { readonly type: 'Literal'; readonly value: DocumentationKey }

export interface DocumentationProperty {
  readonly type: 'Property'
  readonly computed: false
  readonly key: DocumentationKeyNode
  readonly value: unknown
}

export interface DocumentationObject {
  readonly type: 'ObjectExpression'
  readonly properties: ReadonlyArray<DocumentationProperty>
}

const DOCUMENTATION_KEYS: Record<string, true> = {
  identifier: true,
  description: true,
  title: true,
  documentation: true,
  examples: true,
}

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const hasStringType = (value: object): boolean => 'type' in value && typeof value.type === 'string'

const isAstNode = (value: unknown): value is AstNode => isObject(value) && hasStringType(value)

const isNodeOfType = (value: unknown, type: string): value is AstNode => isAstNode(value) && value.type === type

const hasStringName = (value: object): boolean => 'name' in value && typeof value.name === 'string'

const hasStringValue = (value: object): boolean => 'value' in value && typeof value.value === 'string'

const isDocumentationKey = (value: unknown): value is DocumentationKey =>
  typeof value === 'string' && DOCUMENTATION_KEYS[value] === true

const hasDocumentationName = (value: object): boolean => 'name' in value && isDocumentationKey(value.name)

const hasDocumentationValue = (value: object): boolean => 'value' in value && isDocumentationKey(value.value)

const isIdentifierKeyNode = (value: unknown): boolean =>
  isNodeOfType(value, 'Identifier') && hasDocumentationName(value)

const isLiteralKeyNode = (value: unknown): boolean => isNodeOfType(value, 'Literal') && hasDocumentationValue(value)

const isDocumentationKeyNode = (value: unknown): value is DocumentationKeyNode =>
  isIdentifierKeyNode(value) || isLiteralKeyNode(value)

const hasObjectNode = (value: object): boolean => 'object' in value && isAstNode(value.object)

const hasPropertyNode = (value: object): boolean => 'property' in value && isAstNode(value.property)

const hasMemberEnds = (value: object): boolean => hasObjectNode(value) && hasPropertyNode(value)

const isAstNodeArray = (value: unknown): value is ReadonlyArray<AstNode> =>
  Array.isArray(value) && value.every(isAstNode)

const hasCalleeNode = (value: object): boolean => 'callee' in value && isAstNode(value.callee)

const hasArgumentNodes = (value: object): boolean => 'arguments' in value && isAstNodeArray(value.arguments)

const hasCallEnds = (value: object): boolean => hasCalleeNode(value) && hasArgumentNodes(value)

const hasDocumentationKeyNode = (value: object): boolean => 'key' in value && isDocumentationKeyNode(value.key)

const hasComputedFalse = (value: object): boolean => 'computed' in value && value.computed === false

const hasDocumentationPropertyFields = (value: object): boolean =>
  hasComputedFalse(value) && hasDocumentationKeyNode(value)

const isNonEmptyArray = (value: unknown): value is ReadonlyArray<unknown> => Array.isArray(value) && value.length > 0

const everyDocumentationProperty = (value: ReadonlyArray<unknown>): boolean => value.every(isDocumentationProperty)

const isDocumentationArray = (value: unknown): value is ReadonlyArray<DocumentationProperty> =>
  isNonEmptyArray(value) && everyDocumentationProperty(value)

const hasPropertiesField = (value: object): boolean => 'properties' in value && isDocumentationArray(value.properties)

export const isIdentifier = (value: unknown): value is Identifier =>
  isNodeOfType(value, 'Identifier') && hasStringName(value)

export const isStringLiteral = (value: unknown): value is StringLiteral =>
  isNodeOfType(value, 'Literal') && hasStringValue(value)

export const isObjectExpression = (value: unknown): value is ObjectExpression => isNodeOfType(value, 'ObjectExpression')

export const isArrowFunctionExpression = (value: unknown): value is ArrowFunctionExpression =>
  isNodeOfType(value, 'ArrowFunctionExpression')

export const isMemberExpression = (value: unknown): value is MemberExpression =>
  isNodeOfType(value, 'MemberExpression') && hasMemberEnds(value)

export const isCallExpression = (value: unknown): value is CallExpression =>
  isNodeOfType(value, 'CallExpression') && hasCallEnds(value)

export const isDocumentationProperty = (value: unknown): value is DocumentationProperty =>
  isNodeOfType(value, 'Property') && hasDocumentationPropertyFields(value)

export const isDocumentationObject = (value: unknown): value is DocumentationObject =>
  isNodeOfType(value, 'ObjectExpression') && hasPropertiesField(value)
