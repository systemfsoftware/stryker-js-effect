import type {
  CallExpression,
  Expression,
  Ignorer,
  MemberExpression,
  Node,
  ObjectExpression,
  ObjectProperty,
} from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer, type IgnorerContext } from '@systemfsoftware/stryker-ignorer-kit'

export const SYMBOL_DESCRIPTION_IGNORED = 'Symbol.for() brand description is identity-only data, not behaviour' as const
export const TAGGED_TAG_IGNORED = 'TaggedClass/TaggedError _tag is a declaration discriminant, not behaviour' as const
export const TAGGED_FIELDS_IGNORED = 'TaggedClass/TaggedError field schema is a declaration, not behaviour' as const
export const CLASS_ID_IGNORED = 'Schema.Class identifier is a declaration name, not behaviour' as const
export const BRAND_NAME_IGNORED = 'Schema.brand name is identity-only data, not behaviour' as const
export const OPTIONAL_DEFAULT_IGNORED = 'optionalWith default value is config, not behaviour' as const
export const ANNOTATION_OBJECT_IGNORED =
  'annotations object holding only documentation is a declaration, not behaviour' as const
export const ANNOTATION_TEXT_IGNORED = 'annotation documentation value is declaration data, not behaviour' as const

const DOCUMENTATION_KEYS: Record<string, true> = {
  identifier: true,
  description: true,
  title: true,
  documentation: true,
  examples: true,
}

export type DocumentationKey = 'identifier' | 'description' | 'title' | 'documentation' | 'examples'

const TAGGED_FACTORIES: readonly string[] = ['TaggedClass', 'TaggedError']
const CLASS_FACTORY = 'Class'

const isIdentifierNamed = (node: Node, name: string) => node.type === 'Identifier' && node.name === name

const isIdentifierAmong = (node: Node, names: readonly string[]) =>
  node.type === 'Identifier' && names.includes(node.name)

const isPlainMember = (node: Node): node is MemberExpression =>
  node.type === 'MemberExpression' && node.computed === false

const isMemberObjectNamed = (node: Node, object: string) =>
  isPlainMember(node) && isIdentifierNamed(node.object, object)

const isMemberPropertyNamed = (node: Node, property: string) =>
  isPlainMember(node) && isIdentifierNamed(node.property, property)

const isSymbolForCallee = (callee: Expression) =>
  isMemberObjectNamed(callee, 'Symbol') && isMemberPropertyNamed(callee, 'for')

const isFactoryReference = (reference: Expression, factories: readonly string[]) =>
  isPlainMember(reference) && isIdentifierAmong(reference.property, factories)

const isTaggedFactoryCallee = (callee: Expression) =>
  callee.type === 'CallExpression' && isFactoryReference(callee.callee, TAGGED_FACTORIES)

const isClassFactoryCallee = (callee: Expression) => isMemberPropertyNamed(callee, CLASS_FACTORY)

const isBrandCallee = (callee: Expression) => isMemberPropertyNamed(callee, 'brand')

const isAnnotationsCallee = (callee: Expression) => isMemberPropertyNamed(callee, 'annotations')

const isOptionalWithCallee = (callee: Expression) =>
  isMemberObjectNamed(callee, 'S') && isMemberPropertyNamed(callee, 'optionalWith')

const holdsCallOf = (
  call: CallExpression | undefined,
  callee: (expression: Expression) => boolean,
): call is CallExpression => call !== undefined && callee(call.callee)

const holdsArgumentOf = (
  node: Node,
  call: CallExpression | undefined,
  index: number,
  callee: (expression: Expression) => boolean,
) => holdsCallOf(call, callee) && call.arguments[index] === node

const isDocumentationKey = (value: unknown): value is DocumentationKey =>
  typeof value === 'string' && DOCUMENTATION_KEYS[value] === true

const isLiteralKeyNamed = (key: Node) => key.type === 'Literal' && isDocumentationKey(key.value)

const isDocumentationKeyNode = (key: Node) =>
  key.type === 'Identifier' ? isDocumentationKey(key.name) : isLiteralKeyNamed(key)

const isComputedFreeProperty = (property: Node): property is ObjectProperty =>
  property.type === 'Property' && property.computed === false

const isDocumentationEntry = (property: Node) =>
  isComputedFreeProperty(property) && isDocumentationKeyNode(property.key)

const holdsDocumentationEntries = (properties: readonly Node[]) =>
  properties.length > 0 && properties.every(isDocumentationEntry)

const isDocumentationOnlyObject = (node: Node) =>
  node.type === 'ObjectExpression' && holdsDocumentationEntries(node.properties)

const holdsDocumentationObjectArgument = (node: Node, call: CallExpression | undefined) =>
  isDocumentationOnlyObject(node) && holdsArgumentOf(node, call, 0, isAnnotationsCallee)

const isCallNode = (node: Node | undefined): node is CallExpression =>
  node !== undefined && node.type === 'CallExpression'

const asCall = (node: Node | undefined) => (isCallNode(node) ? node : undefined)

type PropertyNode = Extract<Node, { readonly type: 'Property' }>
const isEntryNode = (property: PropertyNode | undefined): property is PropertyNode =>
  property !== undefined && isDocumentationEntry(property)

const isDocumentationEntryValue = (property: PropertyNode | undefined, node: Node) =>
  isEntryNode(property) && property.value === node

const isObjectNode = (node: Node | undefined): node is ObjectExpression =>
  node !== undefined && node.type === 'ObjectExpression'

const isObjectArgumentOfAnnotations = (object: Node | undefined, call: Node | undefined) =>
  isObjectNode(object) && holdsArgumentOf(object, asCall(call), 0, isAnnotationsCallee)

interface ArgumentRule {
  readonly holds: (node: Node, call: CallExpression | undefined) => boolean
  readonly reason: string
}
const argumentRule = (
  index: number,
  callee: (expression: Expression) => boolean,
  reason: string,
): ArgumentRule => ({ holds: (node, call) => holdsArgumentOf(node, call, index, callee), reason })

const LITERAL_ARGUMENT_RULES: readonly ArgumentRule[] = [
  argumentRule(0, isSymbolForCallee, SYMBOL_DESCRIPTION_IGNORED),
  argumentRule(0, isTaggedFactoryCallee, TAGGED_TAG_IGNORED),
  argumentRule(0, isClassFactoryCallee, CLASS_ID_IGNORED),
  argumentRule(0, isBrandCallee, BRAND_NAME_IGNORED),
]

const OBJECT_ARGUMENT_RULES: readonly ArgumentRule[] = [
  argumentRule(1, isTaggedFactoryCallee, TAGGED_FIELDS_IGNORED),
  {
    holds: holdsDocumentationObjectArgument,
    reason: ANNOTATION_OBJECT_IGNORED,
  },
]

const ARROW_ARGUMENT_RULES: readonly ArgumentRule[] = [
  argumentRule(1, isOptionalWithCallee, OPTIONAL_DEFAULT_IGNORED),
]

const firstArgumentReason = (rules: readonly ArgumentRule[], node: Node, call: CallExpression | undefined) =>
  rules.find((rule) => rule.holds(node, call))?.reason

const isDocumentedAnnotationValue = (node: Node, ctx: IgnorerContext) => {
  const property = ctx.parentIf('Property')
  return isDocumentationEntryValue(property, node) &&
    isObjectArgumentOfAnnotations(ctx.ancestors[1], ctx.ancestors[2])
}

const documentationValueReason = (node: Node, ctx: IgnorerContext) =>
  isDocumentedAnnotationValue(node, ctx) ? ANNOTATION_TEXT_IGNORED : undefined

export const strykerIgnorers: readonly Ignorer[] = [
  defineIgnorer({
    name: 'effect-schema-declarations',
    visitors: {
      Literal: (node, ctx) => {
        const parent = ctx.parentIf('CallExpression')
        return firstArgumentReason(LITERAL_ARGUMENT_RULES, node, parent) ?? documentationValueReason(node, ctx)
      },
      ObjectExpression: (node, ctx) => {
        const parent = ctx.parentIf('CallExpression')
        return firstArgumentReason(OBJECT_ARGUMENT_RULES, node, parent)
      },
      ArrowFunctionExpression: (node, ctx) => {
        const parent = ctx.parentIf('CallExpression')
        return firstArgumentReason(ARROW_ARGUMENT_RULES, node, parent)
      },
    },
  }),
]
