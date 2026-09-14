import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  IdentifierReference,
  MemberExpression,
  ObjectExpression,
  ObjectProperty,
  StringLiteral,
} from '@systemfsoftware/stryker-ignorer-interface'

const DOCUMENTATION_KEYS: Record<string, true> = {
  identifier: true,
  description: true,
  title: true,
  documentation: true,
  examples: true,
}

export type DocumentationKey = 'identifier' | 'description' | 'title' | 'documentation' | 'examples'

interface TypedNode {
  readonly type: string
}

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const hasStringType = (value: object): value is TypedNode => 'type' in value && typeof value.type === 'string'

const isAstNode = (value: unknown): value is TypedNode => isObject(value) && hasStringType(value)

const isNodeOfType = (value: unknown, type: string): value is TypedNode => isAstNode(value) && value.type === type

const hasStringName = (value: TypedNode): boolean => 'name' in value && typeof value.name === 'string'

const hasStringValue = (value: TypedNode): boolean => 'value' in value && typeof value.value === 'string'

const isDocumentationKey = (value: unknown): value is DocumentationKey =>
  typeof value === 'string' && DOCUMENTATION_KEYS[value] === true

const hasDocumentationName = (value: TypedNode): boolean => 'name' in value && isDocumentationKey(value.name)

const hasDocumentationValue = (value: TypedNode): boolean => 'value' in value && isDocumentationKey(value.value)

const isIdentifierKeyNode = (value: unknown): boolean =>
  isNodeOfType(value, 'Identifier') && hasDocumentationName(value)

const isLiteralKeyNode = (value: unknown): boolean => isNodeOfType(value, 'Literal') && hasDocumentationValue(value)

const isDocumentationKeyNode = (value: unknown): boolean => isIdentifierKeyNode(value) || isLiteralKeyNode(value)

const hasObjectNode = (value: TypedNode): boolean => 'object' in value && isAstNode(value.object)

const hasPropertyNode = (value: TypedNode): boolean => 'property' in value && isAstNode(value.property)

const hasMemberEnds = (value: TypedNode): boolean => hasObjectNode(value) && hasPropertyNode(value)

const isAstNodeArray = (value: unknown): value is ReadonlyArray<TypedNode> =>
  Array.isArray(value) && value.every(isAstNode)

const hasCalleeNode = (value: TypedNode): boolean => 'callee' in value && isAstNode(value.callee)

const hasArgumentNodes = (value: TypedNode): boolean => 'arguments' in value && isAstNodeArray(value.arguments)

const hasCallEnds = (value: TypedNode): boolean => hasCalleeNode(value) && hasArgumentNodes(value)

const hasDocumentationKeyNode = (value: TypedNode): boolean => 'key' in value && isDocumentationKeyNode(value.key)

const hasComputedFalse = (value: TypedNode): boolean => 'computed' in value && value.computed === false

const hasDocumentationPropertyFields = (value: TypedNode): boolean =>
  hasComputedFalse(value) && hasDocumentationKeyNode(value)

const hasDocumentationEntries = (value: ReadonlyArray<unknown>): boolean =>
  value.length > 0 && value.every(isDocumentationProperty)

const isDocumentationArray = (value: unknown): value is ReadonlyArray<ObjectProperty> =>
  Array.isArray(value) && hasDocumentationEntries(value)

const hasPropertiesField = (value: TypedNode): boolean =>
  'properties' in value && isDocumentationArray(value.properties)

export const isIdentifier = (value: unknown): value is IdentifierReference =>
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

export const isDocumentationProperty = (value: unknown): value is ObjectProperty =>
  isNodeOfType(value, 'Property') && hasDocumentationPropertyFields(value)

export const isDocumentationObject = (value: unknown): value is ObjectExpression =>
  isNodeOfType(value, 'ObjectExpression') && hasPropertiesField(value)

export const SYMBOL_DESCRIPTION_IGNORED = 'Symbol.for() brand description is identity-only data, not behaviour' as const
export const TAGGED_TAG_IGNORED = 'TaggedClass/TaggedError _tag is a declaration discriminant, not behaviour' as const
export const TAGGED_FIELDS_IGNORED = 'TaggedClass/TaggedError field schema is a declaration, not behaviour' as const
export const CLASS_ID_IGNORED = 'Schema.Class identifier is a declaration name, not behaviour' as const
export const CLASS_FIELDS_IGNORED = 'Schema.Class field schema is a declaration, not behaviour' as const
export const BRAND_NAME_IGNORED = 'Schema.brand name is identity-only data, not behaviour' as const
export const OPTIONAL_DEFAULT_IGNORED = 'optionalWith default value is config, not behaviour' as const
export const ANNOTATION_OBJECT_IGNORED =
  'annotations object holding only documentation is a declaration, not behaviour' as const
export const ANNOTATION_TEXT_IGNORED = 'annotation documentation value is declaration data, not behaviour' as const

const TAGGED_FACTORIES: readonly string[] = ['TaggedClass', 'TaggedError']

/**
 * `Schema.Class` is curried the other way round from `Schema.TaggedClass`.
 *
 * `S.TaggedClass<A>()('tag', fields)` puts both the discriminant and the fields on the outer
 * call, so one callee predicate reaches both. `S.Class<A>('Id')(fields)` puts the identifier on
 * the *inner* call and the fields on the outer one, so the same declaration data needs two
 * predicates. Missing that shape is why a class-shaped schema kept fourteen mutants a
 * tag-shaped one never had.
 */
const CLASS_FACTORY = 'Class'

const isIdentifierNamed = (node: TypedNode, name: string): boolean => isIdentifier(node) && node.name === name

const isIdentifierIn = (node: TypedNode, names: readonly string[]): boolean =>
  isIdentifier(node) && names.includes(node.name)

const isMemberNamed = (member: MemberExpression, object: string, property: string): boolean =>
  isIdentifierNamed(member.object, object) && isIdentifierNamed(member.property, property)

const isNamedMember = (node: Expression, object: string, property: string): boolean =>
  isMemberExpression(node) && isMemberNamed(node, object, property)

const isSymbolForCallee = (callee: Expression): boolean => isNamedMember(callee, 'Symbol', 'for')

const isNamedFactoryReference = (reference: Expression, names: readonly string[]): boolean =>
  isMemberExpression(reference) && isIdentifierIn(reference.property, names)

const isTaggedFactoryReference = (reference: Expression): boolean =>
  isNamedFactoryReference(reference, TAGGED_FACTORIES)

const isClassFactoryReference = (reference: Expression): boolean => isNamedFactoryReference(reference, [CLASS_FACTORY])

const isBrandCallee = (callee: Expression): boolean =>
  isMemberExpression(callee) && isIdentifierNamed(callee.property, 'brand')

const isTaggedFactoryCallee = (callee: Expression): boolean =>
  isCallExpression(callee) && isTaggedFactoryReference(callee.callee)

const isArgumentAt = (
  node: unknown,
  call: CallExpression,
  index: number,
  calleeMatches: (callee: Expression) => boolean,
): boolean => calleeMatches(call.callee) && call.arguments[index] === node

const isArgumentOf = (
  node: unknown,
  parent: unknown,
  index: number,
  calleeMatches: (callee: Expression) => boolean,
): boolean => isCallExpression(parent) && isArgumentAt(node, parent, index, calleeMatches)

interface IgnoreRule {
  readonly matches: (node: unknown, parent: unknown, grandparent: unknown, ancestor: unknown) => boolean
  readonly reason: string
}

const isOptionalWithCallee = (callee: Expression): boolean => isNamedMember(callee, 'S', 'optionalWith')

const isAnnotationsCallee = (callee: Expression): boolean =>
  isMemberExpression(callee) && isIdentifierNamed(callee.property, 'annotations')

const argumentRule = (
  is: (node: unknown) => node is TypedNode,
  argumentIndex: number,
  calleeMatches: (callee: Expression) => boolean,
  reason: string,
): IgnoreRule => ({
  matches: (node, parent) => is(node) && isArgumentOf(node, parent, argumentIndex, calleeMatches),
  reason,
})

/**
 * A documentation-keyed entry of an `annotations` call. Unlike the object rule
 * this does not care what sits beside it: `title` is documentation whether or
 * not an `arbitrary` shares the object, because replacing the title cannot
 * change what the schema does. Emptying the whole object could, which is why
 * that rule is the stricter of the two.
 */
const isDocumentationValue = (node: unknown, parent: ObjectProperty): boolean => parent.value === node

const isDocumentationPropertyValue = (node: unknown, parent: unknown): boolean =>
  isDocumentationProperty(parent) && isDocumentationValue(node, parent)

const documentationValueRule: IgnoreRule = {
  matches: (node, parent, grandparent, ancestor) =>
    isDocumentationPropertyValue(node, parent) && isArgumentOf(grandparent, ancestor, 0, isAnnotationsCallee),
  reason: ANNOTATION_TEXT_IGNORED,
}

const RULES: readonly IgnoreRule[] = [
  argumentRule(isStringLiteral, 0, isSymbolForCallee, SYMBOL_DESCRIPTION_IGNORED),
  argumentRule(isStringLiteral, 0, isTaggedFactoryCallee, TAGGED_TAG_IGNORED),
  argumentRule(isObjectExpression, 1, isTaggedFactoryCallee, TAGGED_FIELDS_IGNORED),
  argumentRule(isStringLiteral, 0, isClassFactoryReference, CLASS_ID_IGNORED),
  argumentRule(isStringLiteral, 0, isBrandCallee, BRAND_NAME_IGNORED),
  argumentRule(isArrowFunctionExpression, 1, isOptionalWithCallee, OPTIONAL_DEFAULT_IGNORED),
  argumentRule(isDocumentationObject, 0, isAnnotationsCallee, ANNOTATION_OBJECT_IGNORED),
  documentationValueRule,
]

export const decideSchemaDeclarationIgnore = (
  node: unknown,
  parent: unknown,
  grandparent?: unknown,
  ancestor?: unknown,
): string | undefined => RULES.find((rule) => rule.matches(node, parent, grandparent, ancestor))?.reason
