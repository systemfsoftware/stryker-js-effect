import type {
  CallExpression,
  Expression,
  Ignorer,
  MemberExpression,
  Node,
  ObjectExpression,
  ObjectProperty,
  VariableDeclarator,
} from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer, type IgnorerContext } from '@systemfsoftware/stryker-ignorer-kit'

export const SYMBOL_DESCRIPTION_IGNORED = 'Symbol.for() brand description is identity-only data, not behaviour' as const
export const TAGGED_TAG_IGNORED = 'TaggedClass/TaggedError _tag is a declaration discriminant, not behaviour' as const
export const TAGGED_STRUCT_TAG_IGNORED = 'TaggedStruct _tag is a declaration discriminant, not behaviour' as const
export const TAGGED_FIELDS_IGNORED = 'TaggedClass/TaggedError field schema is a declaration, not behaviour' as const
export const CLASS_ID_IGNORED = 'Schema.Class identifier is a declaration name, not behaviour' as const
export const BRAND_NAME_IGNORED = 'Schema.brand name is identity-only data, not behaviour' as const
export const OPTIONAL_DEFAULT_IGNORED = 'optionalWith default value is config, not behaviour' as const
export const DECODING_DEFAULT_IGNORED =
  'withDecodingDefault/withConstructorDefault default is config, not behaviour' as const
export const ANNOTATION_OBJECT_IGNORED =
  'annotations object holding only documentation is a declaration, not behaviour' as const
export const ANNOTATION_TEXT_IGNORED = 'annotation documentation value is declaration data, not behaviour' as const
export const CHECK_ANNOTATION_OBJECT_IGNORED =
  'filter/check annotation object holds documentation and generation hints, not behaviour' as const
export const CHECK_ANNOTATION_TEXT_IGNORED =
  'filter/check annotation value is documentation data, not behaviour' as const
export const GENERATION_ANNOTATION_IGNORED =
  'arbitrary-generation annotation never runs in production, not behaviour' as const
export const LINK_TRANSFORMATION_IGNORED =
  'S.link() transformation feeds arbitrary generation only, not production codecs' as const
export const TYPE_ID_IGNORED = 'a TypeId constant is a declaration identity, not behaviour' as const

const DOCUMENTATION_KEYS: Record<string, true> = {
  identifier: true,
  description: true,
  title: true,
  documentation: true,
  examples: true,
}

const CHECK_TEXT_KEYS: Record<string, true> = {
  ...DOCUMENTATION_KEYS,
  expected: true,
  message: true,
}

const GENERATION_KEYS: Record<string, true> = {
  toCodecArbitrary: true,
  toArbitrary: true,
  arbitraryConstraint: true,
  arbitrary: true,
}

const PRODUCTION_CODEC_KEYS: Record<string, true> = {
  toCodec: true,
  toCodecJson: true,
  toCodecStringTree: true,
  toCodecIso: true,
}

export type DocumentationKey = 'identifier' | 'description' | 'title' | 'documentation' | 'examples'

const TAGGED_FACTORIES: readonly string[] = ['TaggedClass', 'TaggedError']
const TAGGED_STRUCT_FACTORIES: readonly string[] = ['TaggedStruct']
const ANNOTATION_CALLEES: readonly string[] = ['annotations', 'annotate']
const ANNOTATION_OBJECT_CALLEES: readonly string[] = ['makeFilter', 'makeFilterGroup', 'declare']
const DEFAULT_CALLEES: readonly string[] = ['withDecodingDefault', 'withDecodingDefaultKey', 'withConstructorDefault']

const isIdentifierNamed = (node: Node, name: string) => node.type === 'Identifier' && node.name === name

const isIdentifierAmong = (node: Node, names: readonly string[]) =>
  node.type === 'Identifier' && names.includes(node.name)

const isPlainMember = (node: Node): node is MemberExpression =>
  node.type === 'MemberExpression' && node.computed === false

const isMemberObjectNamed = (node: Node, object: string) =>
  isPlainMember(node) && isIdentifierNamed(node.object, object)

const isMemberPropertyNamed = (node: Node, property: string) =>
  isPlainMember(node) && isIdentifierNamed(node.property, property)

const isMemberPropertyAmong = (node: Node, properties: readonly string[]) =>
  isPlainMember(node) && isIdentifierAmong(node.property, properties)

const isSymbolForCallee = (callee: Expression) =>
  isMemberObjectNamed(callee, 'Symbol') && isMemberPropertyNamed(callee, 'for')

const isFactoryReference = (reference: Expression, factories: readonly string[]) =>
  isPlainMember(reference) && isIdentifierAmong(reference.property, factories)

const isTaggedFactoryCallee = (callee: Expression) =>
  callee.type === 'CallExpression' && isFactoryReference(callee.callee, TAGGED_FACTORIES)

const isTaggedStructCallee = (callee: Expression) => isFactoryReference(callee, TAGGED_STRUCT_FACTORIES)

const isClassFactoryCallee = (callee: Expression) => isMemberPropertyNamed(callee, 'Class')

const isBrandCallee = (callee: Expression) => isMemberPropertyNamed(callee, 'brand')

const isLinkMember = (callee: Expression) => isMemberPropertyNamed(callee, 'link')

const isLinkFactoryCall = (callee: Expression) => callee.type === 'CallExpression' && isLinkMember(callee.callee)

const isLinkCallee = (callee: Expression) => isLinkMember(callee) || isLinkFactoryCall(callee)

const isAnnotationsCallee = (callee: Expression) => isMemberPropertyAmong(callee, ANNOTATION_CALLEES)

const isAnnotationObjectCallee = (callee: Expression) => isMemberPropertyAmong(callee, ANNOTATION_OBJECT_CALLEES)

const isDefaultCallee = (callee: Expression) => isMemberPropertyAmong(callee, DEFAULT_CALLEES)

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

const isKeyedByName = (value: unknown, keys: Record<string, true>) => typeof value === 'string' && keys[value] === true

const isLiteralKeyOf = (key: Node, keys: Record<string, true>) =>
  key.type === 'Literal' && isKeyedByName(key.value, keys)

const isKeyOf = (key: Node, keys: Record<string, true>) =>
  key.type === 'Identifier' ? isKeyedByName(key.name, keys) : isLiteralKeyOf(key, keys)

const isPropertyNode = (node: Node | undefined): node is ObjectProperty =>
  node !== undefined && node.type === 'Property'

const isComputedFreeProperty = (node: Node | undefined): node is ObjectProperty =>
  isPropertyNode(node) && node.computed === false

const isCallNode = (node: Node | undefined): node is CallExpression =>
  node !== undefined && node.type === 'CallExpression'

const isObjectNode = (node: Node | undefined): node is ObjectExpression =>
  node !== undefined && node.type === 'ObjectExpression'

const isVariableDeclarator = (node: Node | undefined): node is VariableDeclarator => node?.type === 'VariableDeclarator'

const asCall = (node: Node | undefined) => (isCallNode(node) ? node : undefined)

const isDocumentationKeyNode = (key: Node) => isKeyOf(key, DOCUMENTATION_KEYS)

const isCheckTextKeyNode = (key: Node) => isKeyOf(key, CHECK_TEXT_KEYS)

const isGenerationKeyNode = (key: Node) => isKeyOf(key, GENERATION_KEYS)

const isDocumentationOrCheckKeyNode = (key: Node) => isDocumentationKeyNode(key) || isCheckTextKeyNode(key)

const isDeclarationKeyNode = (key: Node) => isDocumentationOrCheckKeyNode(key) || isGenerationKeyNode(key)

const isDocumentationEntry = (property: Node) =>
  isComputedFreeProperty(property) && isDocumentationKeyNode(property.key)

const isDeclarationEntry = (property: Node) => isComputedFreeProperty(property) && isDeclarationKeyNode(property.key)

const holdsEntries = (properties: readonly Node[], holds: (property: Node) => boolean) =>
  properties.length > 0 && properties.every(holds)

const isDocumentationOnlyObject = (node: Node) =>
  isObjectNode(node) && holdsEntries(node.properties, isDocumentationEntry)

const isDeclarationAnnotationObject = (node: Node) =>
  isObjectNode(node) && holdsEntries(node.properties, isDeclarationEntry)

const isArgumentAt = (
  node: Node | undefined,
  call: Node | undefined,
  index: number,
  callee: (expression: Expression) => boolean,
) => isObjectNode(node) && holdsArgumentOf(node, asCall(call), index, callee)

const isDocumentationObjectArgument = (node: Node, call: CallExpression | undefined) =>
  isDocumentationOnlyObject(node) && holdsArgumentOf(node, call, 0, isAnnotationsCallee)

const isDeclarationAnnotationArgument = (node: Node, call: CallExpression | undefined) =>
  isDeclarationAnnotationObject(node) && holdsArgumentOf(node, call, 1, isAnnotationObjectCallee)

interface ArgumentRule {
  readonly holds: (node: Node, call: CallExpression | undefined) => boolean
  readonly reason: string
}

const simpleArgumentRule = (
  index: number,
  callee: (expression: Expression) => boolean,
  reason: string,
): ArgumentRule => ({ holds: (node, call) => holdsArgumentOf(node, call, index, callee), reason })

const LITERAL_ARGUMENT_RULES: readonly ArgumentRule[] = [
  simpleArgumentRule(0, isSymbolForCallee, SYMBOL_DESCRIPTION_IGNORED),
  simpleArgumentRule(0, isTaggedFactoryCallee, TAGGED_TAG_IGNORED),
  simpleArgumentRule(0, isTaggedStructCallee, TAGGED_STRUCT_TAG_IGNORED),
  simpleArgumentRule(0, isClassFactoryCallee, CLASS_ID_IGNORED),
  simpleArgumentRule(0, isBrandCallee, BRAND_NAME_IGNORED),
]

const OBJECT_ARGUMENT_RULES: readonly ArgumentRule[] = [
  simpleArgumentRule(1, isTaggedFactoryCallee, TAGGED_FIELDS_IGNORED),
  { holds: isDocumentationObjectArgument, reason: ANNOTATION_OBJECT_IGNORED },
  { holds: isDeclarationAnnotationArgument, reason: CHECK_ANNOTATION_OBJECT_IGNORED },
]

const ARROW_ARGUMENT_RULES: readonly ArgumentRule[] = [
  simpleArgumentRule(1, isOptionalWithCallee, OPTIONAL_DEFAULT_IGNORED),
]

const firstArgumentReason = (rules: readonly ArgumentRule[], node: Node, call: CallExpression | undefined) =>
  rules.find((rule) => rule.holds(node, call))?.reason

interface Slot {
  readonly child: Node
  readonly ancestor: Node | undefined
  readonly holder: Node | undefined
  readonly call: CallExpression | undefined
}

interface EntrySlot extends Slot {
  readonly ancestor: ObjectProperty
}

interface CallSlot extends Slot {
  readonly ancestor: CallExpression
}

interface DeclaratorSlot extends Slot {
  readonly ancestor: VariableDeclarator
}

const slotsOf = (node: Node, ancestors: readonly Node[]): readonly Slot[] =>
  [node, ...ancestors].map((child, index) => ({
    child,
    ancestor: ancestors[index],
    holder: ancestors[index + 1],
    call: asCall(ancestors[index + 2]),
  }))

const isEntrySlot = (slot: Slot): slot is EntrySlot =>
  isComputedFreeProperty(slot.ancestor) && slot.ancestor.value === slot.child

const isAnnotationEntrySlot = (slot: Slot): slot is EntrySlot =>
  isEntrySlot(slot) && isArgumentAt(slot.holder, slot.call, 1, isAnnotationObjectCallee)

const isDocumentationEntrySlot = (slot: Slot): slot is EntrySlot =>
  isEntrySlot(slot) && isDocumentationKeyNode(slot.ancestor.key)

const isDocumentationSlot = (slot: Slot): slot is EntrySlot =>
  isDocumentationEntrySlot(slot) && isArgumentAt(slot.holder, slot.call, 0, isAnnotationsCallee)

const isCallArgumentSlot = (slot: Slot, index: number): slot is CallSlot =>
  isCallNode(slot.ancestor) && slot.ancestor.arguments[index] === slot.child

const isArgumentSlot = (slot: Slot, index: number, callee: (expression: Expression) => boolean) =>
  isCallArgumentSlot(slot, index) && callee(slot.ancestor.callee)

const isDeclaratorSlot = (slot: Slot): slot is DeclaratorSlot =>
  isVariableDeclarator(slot.ancestor) && slot.ancestor.init === slot.child

const isDirectDeclaratorSlot = (node: Node) => (slot: Slot): slot is DeclaratorSlot =>
  isDeclaratorSlot(slot) && isDirectInitializer(slot, node)

const isTypeIdSlot = (node: Node) => (slot: Slot): slot is DeclaratorSlot =>
  isDirectDeclaratorSlot(node)(slot) && isTypeIdName(slot)

const isDirectInitializer = (slot: DeclaratorSlot, node: Node) =>
  slot.child === node || isAsExpressionOf(slot.child, node)

const isAsExpressionOf = (child: Node, node: Node) => child.type === 'TSAsExpression' && child.expression === node

const isTypeIdName = (slot: DeclaratorSlot) =>
  slot.ancestor.id.type === 'Identifier' && slot.ancestor.id.name === 'TypeId'

const generationKeyReason = (key: Node) => isGenerationKeyNode(key) ? GENERATION_ANNOTATION_IGNORED : undefined

const textKeyReason = (key: Node) => isCheckTextKeyNode(key) ? CHECK_ANNOTATION_TEXT_IGNORED : undefined

const keyReason = (key: Node) => generationKeyReason(key) ?? textKeyReason(key)

const entrySlotReason = (slot: Slot) => isAnnotationEntrySlot(slot) ? keyReason(slot.ancestor.key) : undefined

const documentationSlotReason = (slot: Slot) => isDocumentationSlot(slot) ? ANNOTATION_TEXT_IGNORED : undefined

const argumentSlotReason =
  (index: number, callee: (expression: Expression) => boolean, reason: string) => (slot: Slot) =>
    isArgumentSlot(slot, index, callee) ? reason : undefined

const typeIdSlotReason = (node: Node) => (slot: Slot) => isTypeIdSlot(node)(slot) ? TYPE_ID_IGNORED : undefined

const isProductionCodecKey = (key: Node) => isKeyOf(key, PRODUCTION_CODEC_KEYS)

const isProductionCodecSlot = (slot: Slot): slot is EntrySlot =>
  isAnnotationEntrySlot(slot) && isProductionCodecKey(slot.ancestor.key)

const isOutsideProductionCodec = (slots: readonly Slot[]) => !slots.some(isProductionCodecSlot)

const isIgnorableLinkSlot = (slot: Slot, slots: readonly Slot[]) =>
  isArgumentSlot(slot, 1, isLinkCallee) && isOutsideProductionCodec(slots)

const linkSlotReason = (slot: Slot, slots: readonly Slot[]) =>
  isIgnorableLinkSlot(slot, slots) ? LINK_TRANSFORMATION_IGNORED : undefined

type SlotRule = (slot: Slot, slots: readonly Slot[]) => string | undefined

const rulesFor = (node: Node): readonly SlotRule[] => [
  documentationSlotReason,
  entrySlotReason,
  linkSlotReason,
  argumentSlotReason(0, isDefaultCallee, DECODING_DEFAULT_IGNORED),
  typeIdSlotReason(node),
]

const firstReasonOf = (slots: readonly Slot[], rules: readonly SlotRule[]) =>
  slots.flatMap((slot) => rules.map((rule) => rule(slot, slots))).find((reason) => reason !== undefined)

const subtreeReasonOf = (node: Node, ctx: IgnorerContext) => firstReasonOf(slotsOf(node, ctx.ancestors), rulesFor(node))

const objectReasonOf = (node: Node, ctx: IgnorerContext) =>
  firstArgumentReason(OBJECT_ARGUMENT_RULES, node, ctx.parentIf('CallExpression')) ?? subtreeReasonOf(node, ctx)

const literalReasonOf = (node: Node, ctx: IgnorerContext) =>
  firstArgumentReason(LITERAL_ARGUMENT_RULES, node, ctx.parentIf('CallExpression')) ?? subtreeReasonOf(node, ctx)

const arrowReasonOf = (node: Node, ctx: IgnorerContext) =>
  firstArgumentReason(ARROW_ARGUMENT_RULES, node, ctx.parentIf('CallExpression')) ?? subtreeReasonOf(node, ctx)

const BY_TYPE_REASON: Record<string, (node: Node, ctx: IgnorerContext) => string | undefined> = {
  ObjectExpression: objectReasonOf,
  Literal: literalReasonOf,
  ArrowFunctionExpression: arrowReasonOf,
}

const ignoredReasonOf = (node: Node, ctx: IgnorerContext) => (BY_TYPE_REASON[node.type] ?? subtreeReasonOf)(node, ctx)

export const strykerIgnorers: readonly Ignorer[] = [
  defineIgnorer({
    name: 'effect-schema-declarations',
    visitors: {
      onAnyNode: ignoredReasonOf,
    },
  }),
]
