import type {
  CallExpression,
  Ignorer,
  MemberExpression,
  Node,
  ObjectExpression,
} from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer } from '@systemfsoftware/stryker-ignorer-kit'

type IdentifierNode = Extract<Node, { readonly type: 'Identifier' }>

export const INPUT_MODEL_OUTPUT_CONFIG_MSG =
  'Angular signal based input, model and output functions configuration object cannot be mutated as that causes issues with the Angular compiler.' as const

export const SIGNAL_QUERY_OPTIONS_MSG =
  'Angular signal query options object cannot be mutated as that causes issues with the Angular compiler.' as const

const SIGNAL_IO_FUNCTIONS: readonly string[] = Object.freeze(['input', 'model', 'output'])

const SIGNAL_QUERY_FUNCTIONS: readonly string[] = Object.freeze([
  'contentChild',
  'contentChildren',
  'viewChild',
  'viewChildren',
])

const CLASS_FIELD_KINDS: readonly string[] = Object.freeze(['PropertyDefinition', 'AccessorProperty'])

const isCallExpression = (node: Node | undefined): node is CallExpression =>
  node !== undefined && node.type === 'CallExpression'

const isObjectExpression = (node: Node): node is ObjectExpression => node.type === 'ObjectExpression'

const isIdentifier = (node: Node): node is IdentifierNode => node.type === 'Identifier'

const isMemberExpression = (node: Node): node is MemberExpression => node.type === 'MemberExpression'

const isIdentifierNamed = (node: Node, name: string): node is IdentifierNode => isIdentifier(node) && node.name === name

const isIdentifierAmong = (node: Node, names: readonly string[]): node is IdentifierNode =>
  isIdentifier(node) && names.includes(node.name)

const isPlainMember = (node: Node): node is MemberExpression => isMemberExpression(node) && !node.computed

const isPlainMemberOf = (node: Node, objectNames: readonly string[]): node is MemberExpression =>
  isPlainMember(node) && isIdentifierAmong(node.object, objectNames)

const plainMemberOf = (node: Node, objectNames: readonly string[]) =>
  isPlainMemberOf(node, objectNames) ? node : undefined

const hasNamedMember = (node: Node, objectNames: readonly string[], propertyName: string) => {
  const member = plainMemberOf(node, objectNames)
  return member !== undefined && isIdentifierNamed(member.property, propertyName)
}

const SIGNAL_IO_ARGUMENT_MATCHERS: readonly (readonly [number, (callee: Node) => boolean])[] = [
  [0, (callee) => hasNamedMember(callee, SIGNAL_IO_FUNCTIONS, 'required')],
  [0, (callee) => isIdentifierNamed(callee, 'output')],
  [1, (callee) => isIdentifierAmong(callee, SIGNAL_IO_FUNCTIONS)],
]

const SIGNAL_QUERY_CALL_MATCHERS: readonly ((callee: Node) => boolean)[] = [
  (callee) => isIdentifierAmong(callee, SIGNAL_QUERY_FUNCTIONS),
  (callee) => hasNamedMember(callee, SIGNAL_QUERY_FUNCTIONS, 'required'),
]

const signalIoArgumentIndex = (callee: Node) => SIGNAL_IO_ARGUMENT_MATCHERS.find(([, matches]) => matches(callee))?.[0]

const isSignalQueryCall = (callee: Node) => SIGNAL_QUERY_CALL_MATCHERS.some((matches) => matches(callee))

const ownsPropertyDefinitionField = (owner: Node | undefined) => owner?.type === 'PropertyDefinition'

const ownsClassField = (owner: Node | undefined) => CLASS_FIELD_KINDS.some((kind) => kind === owner?.type)

type OwnsCallSite = (owner: Node | undefined) => boolean

const holdsArgument = (call: CallExpression, node: Node) =>
  call.arguments.some((argument: unknown) => argument === node)

const isObjectArgumentOf = (node: Node, call: CallExpression) => isObjectExpression(node) && holdsArgument(call, node)

const holdsObjectArgument = (parent: Node | undefined, node: Node): parent is CallExpression =>
  isCallExpression(parent) && isObjectArgumentOf(node, parent)

const objectArgumentCall = (node: Node, parent: Node | undefined): CallExpression | undefined =>
  holdsObjectArgument(parent, node) ? parent : undefined

const ownedCallOf = (
  node: Node,
  parent: Node | undefined,
  owner: Node | undefined,
  ownsCallSite: OwnsCallSite,
) => {
  const call = objectArgumentCall(node, parent)
  return ownsCallSite(owner) ? call : undefined
}

const isArgumentAt = (index: number | undefined, call: CallExpression, node: Node) =>
  index !== undefined && call.arguments[index] === node

const ioConfigReason = (call: CallExpression, node: Node) =>
  isArgumentAt(signalIoArgumentIndex(call.callee), call, node) ? INPUT_MODEL_OUTPUT_CONFIG_MSG : undefined

const isQueryOptionsArgument = (call: CallExpression, node: Node) =>
  isSignalQueryCall(call.callee) && isArgumentAt(1, call, node)

const queryOptionsReason = (call: CallExpression, node: Node) =>
  isQueryOptionsArgument(call, node) ? SIGNAL_QUERY_OPTIONS_MSG : undefined

const ioReasonFor = (node: Node, parent: Node | undefined, owner: Node | undefined) => {
  const call = ownedCallOf(node, parent, owner, ownsPropertyDefinitionField)
  return call === undefined ? undefined : ioConfigReason(call, node)
}

const queryReasonFor = (node: Node, parent: Node | undefined, owner: Node | undefined) => {
  const call = ownedCallOf(node, parent, owner, ownsClassField)
  return call === undefined ? undefined : queryOptionsReason(call, node)
}

const reasonFor = (node: Node, parent: Node | undefined, owner: Node | undefined) =>
  ioReasonFor(node, parent, owner) ?? queryReasonFor(node, parent, owner)

const pointReason = (node: Node, ancestors: readonly Node[]) => reasonFor(node, ancestors[0], ancestors[1])

const ancestorReason = (ancestors: readonly Node[]) =>
  ancestors.map((ancestor, position) => reasonFor(ancestor, ancestors[position + 1], ancestors[position + 2])).find(
    (reason) => reason !== undefined,
  )

export const shouldIgnore = (node: Node, ancestors: readonly Node[]): string | undefined =>
  pointReason(node, ancestors) ?? ancestorReason(ancestors)

export const strykerIgnorers: readonly Ignorer[] = [
  defineIgnorer({
    name: 'angular-signals',
    visitors: {
      ObjectExpression: (node, ctx) => pointReason(node, ctx.ancestors),
      onAnyNode: (_node, ctx) => ancestorReason(ctx.ancestors),
    },
  }),
]
