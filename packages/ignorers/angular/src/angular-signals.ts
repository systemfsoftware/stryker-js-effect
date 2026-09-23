import type { CallExpression, Ignorer, MemberExpression, Node } from '@systemfsoftware/stryker-ignorer-interface'

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

const isObjectExpression = (node: Node) => node.type === 'ObjectExpression'

const isIdentifier = (node: Node): node is IdentifierNode => node.type === 'Identifier'

const isMemberExpression = (node: Node): node is MemberExpression => node.type === 'MemberExpression'

const isIdentifierNamed = (node: Node, name: string): node is IdentifierNode =>
  isIdentifier(node) && node.name === name

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

const signalIoArgumentIndex = (callee: Node) =>
  SIGNAL_IO_ARGUMENT_MATCHERS.find(([, matches]) => matches(callee))?.[0]

const isSignalQueryCall = (callee: Node) => SIGNAL_QUERY_CALL_MATCHERS.some((matches) => matches(callee))

const ownsPropertyDefinitionField = (owner: Node | undefined) => owner?.type === 'PropertyDefinition'

const ownsClassField = (owner: Node | undefined) => CLASS_FIELD_KINDS.some((kind) => kind === owner?.type)

type OwnsCallSite = (owner: Node | undefined) => boolean

const holdsArgument = (call: CallExpression, node: Node) =>
  call.arguments.some((argument: unknown) => argument === node)

const isObjectArgumentOf = (node: Node, call: CallExpression) =>
  isObjectExpression(node) && holdsArgument(call, node)

const parentCallOf = (ancestors: readonly Node[], offset: number) => {
  const parent = ancestors[offset]
  return isCallExpression(parent) ? parent : undefined
}

const callOfObjectArgument = (node: Node, call: CallExpression) =>
  isObjectArgumentOf(node, call) ? call : undefined

const argumentCallOf = (node: Node, ancestors: readonly Node[], offset: number) => {
  const call = parentCallOf(ancestors, offset)
  return call === undefined ? undefined : callOfObjectArgument(node, call)
}

const ownedCallOf = (node: Node, ancestors: readonly Node[], offset: number, ownsCallSite: OwnsCallSite) => {
  const call = argumentCallOf(node, ancestors, offset)
  return ownsCallSite(ancestors[offset + 1]) ? call : undefined
}

const isArgumentAt = (index: number | undefined, call: CallExpression, node: Node) =>
  index !== undefined && call.arguments[index] === node

const ioConfigReason = (call: CallExpression, node: Node) =>
  isArgumentAt(signalIoArgumentIndex(call.callee), call, node) ? INPUT_MODEL_OUTPUT_CONFIG_MSG : undefined

const isQueryOptionsArgument = (call: CallExpression, node: Node) =>
  isSignalQueryCall(call.callee) && isArgumentAt(1, call, node)

const queryOptionsReason = (call: CallExpression, node: Node) =>
  isQueryOptionsArgument(call, node) ? SIGNAL_QUERY_OPTIONS_MSG : undefined

const ioReasonOf = (node: Node, ancestors: readonly Node[], offset: number) => {
  const call = ownedCallOf(node, ancestors, offset, ownsPropertyDefinitionField)
  return call === undefined ? undefined : ioConfigReason(call, node)
}

const queryReasonOf = (node: Node, ancestors: readonly Node[], offset: number) => {
  const call = ownedCallOf(node, ancestors, offset, ownsClassField)
  return call === undefined ? undefined : queryOptionsReason(call, node)
}

const reasonAt = (node: Node, ancestors: readonly Node[], offset: number) =>
  ioReasonOf(node, ancestors, offset) ?? queryReasonOf(node, ancestors, offset)

const ancestorReason = (node: Node, ancestors: readonly Node[]) =>
  ancestors.map((ancestor, position) => reasonAt(ancestor, ancestors, position + 1)).find((reason) =>
    reason !== undefined
  )

export const shouldIgnore = (node: Node, ancestors: readonly Node[]): string | undefined =>
  reasonAt(node, ancestors, 0) ?? ancestorReason(node, ancestors)

export const strykerIgnorers: readonly Ignorer[] = [
  {
    name: 'angular-signals',
    shouldIgnore,
  },
]
