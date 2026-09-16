import type { Ignorer, Node } from '@systemfsoftware/stryker-framework-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

/**
 * The Angular signal ignorer: the configuration objects of the signal `input`,
 * `model`, and `output` functions and of the signal query functions
 * (`contentChild`, `contentChildren`, `viewChild`, `viewChildren`) are
 * identity-only data to the Angular compiler, so mutating them breaks
 * compilation. It ships beside the Angular format in this package and is
 * auto-selected by the engine because the module that declares it also claims
 * a format.
 */

const ANGULAR_SIGNAL_IO_FUNCTIONS = Object.freeze(['input', 'model', 'output'])

const ANGULAR_SIGNAL_QUERY_FUNCTIONS = Object.freeze([
  'contentChild',
  'contentChildren',
  'viewChild',
  'viewChildren',
])

const INPUT_MODEL_OUTPUT_CONFIG_MSG =
  'Angular signal based input, model and output functions configuration object cannot be mutated as that causes issues with the Angular compiler.'

const SIGNAL_QUERY_OPTIONS_MSG =
  'Angular signal query options object cannot be mutated as that causes issues with the Angular compiler.'

export const angularSignalIgnorer: Ignorer = {
  name: 'angular-signal-io',
  shouldIgnore: (node, ancestors) => Option.getOrUndefined(ignoreReasonOf(node, ancestors)),
}

function ignoreReasonOf(node: Node, ancestors: readonly Node[]): Option.Option<string> {
  return Option.orElse(reasonAt(node, ancestors), () => ancestorReason(node, ancestors))
}

function reasonAt(node: Node, ancestors: readonly Node[], offset = 0): Option.Option<string> {
  return Match.value(node).pipe(
    Match.when(
      (subject: Node) => isInputModelOrOutputConfigurationObject(subject, ancestors, offset),
      () => Option.some(INPUT_MODEL_OUTPUT_CONFIG_MSG),
    ),
    Match.when(
      (subject: Node) => isSignalQueryOptionsObject(subject, ancestors, offset),
      () => Option.some(SIGNAL_QUERY_OPTIONS_MSG),
    ),
    Match.orElse(() => Option.none<string>()),
  )
}

function ancestorReason(node: Node, ancestors: readonly Node[]): Option.Option<string> {
  return Option.flatMap(
    Arr.findFirst(
      ancestors.entries(),
      ([position, ancestor]) => Option.isSome(reasonAt(ancestor, ancestors, position + 1)),
    ),
    ([position, ancestor]) => reasonAt(ancestor, ancestors, position + 1),
  )
}

function isClassFieldLike(node: unknown): boolean {
  return CLASS_FIELD_KINDS.includes(nodeType(node) ?? '')
}

const CLASS_FIELD_KINDS: readonly string[] = Object.freeze(['PropertyDefinition', 'AccessorProperty'])

interface SignalCallSite {
  readonly callee: Node
  readonly args: readonly Node[]
  readonly objectExpression: Node
}

type OwnsCallSite = (owner: Node) => boolean

function isInputModelOrOutputConfigurationObject(node: Node, ancestors: readonly Node[], offset: number): boolean {
  return Option.match(signalCallSiteOf(node, ancestors, offset, isPropertyDefinitionField), {
    onNone: () => false,
    onSome: (site) => isArgumentAt(site, signalIoArgumentIndex(site.callee)),
  })
}

function isSignalQueryOptionsObject(node: Node, ancestors: readonly Node[], offset: number): boolean {
  return Option.match(signalCallSiteOf(node, ancestors, offset, isClassFieldLike), {
    onNone: () => false,
    onSome: (site) => isSignalQueryCall(site.callee) && isArgumentAt(site, Option.some(1)),
  })
}

function isPropertyDefinitionField(node: unknown): boolean {
  return nodeType(node) === 'PropertyDefinition'
}

function signalCallSiteOf(
  node: Node,
  ancestors: readonly Node[],
  offset: number,
  ownsCallSite: OwnsCallSite,
): Option.Option<SignalCallSite> {
  return Option.flatMap(
    ownedCallPath(node, ancestors, offset, ownsCallSite),
    (callNode) => Option.map(callArgumentsOf(callNode), (call) => ({ ...call, objectExpression: node })),
  )
}

function ownedCallPath(
  node: Node,
  ancestors: readonly Node[],
  offset: number,
  ownsCallSite: OwnsCallSite,
): Option.Option<Node> {
  const argument = Option.filter(
    Option.some(node),
    (candidate) => isOwnedCallArgument(candidate, ancestors, offset, ownsCallSite),
  )
  return Option.flatMap(argument, () => Option.fromUndefinedOr(ancestors[offset]))
}

function isOwnedCallArgument(
  node: Node,
  ancestors: readonly Node[],
  offset: number,
  ownsCallSite: OwnsCallSite,
): boolean {
  return isObjectArgumentOfCall(node, ancestors, offset) && ownsCallSiteOf(ancestors, offset, ownsCallSite)
}

function isObjectArgumentOfCall(node: Node, ancestors: readonly Node[], offset: number): boolean {
  return nodeType(node) === 'ObjectExpression' && nodeType(ancestors[offset]) === 'CallExpression'
}

function ownsCallSiteOf(ancestors: readonly Node[], offset: number, ownsCallSite: OwnsCallSite): boolean {
  return Option.exists(Option.fromUndefinedOr(ancestors[offset + 1]), ownsCallSite)
}

interface CallArguments {
  readonly callee: Node
  readonly args: readonly Node[]
}

function callArgumentsOf(callNode: Node): Option.Option<CallArguments> {
  return Option.flatMap(
    Option.filter(Option.some(callNode), hasCallShape),
    (call) => Option.map(nodeArgumentArrayOf(call['arguments']), (args) => ({ callee: call['callee'], args })),
  )
}

function hasCallShape(
  callNode: Node,
): callNode is Node & { readonly callee: Node; readonly arguments: unknown } {
  return Predicate.hasProperty(callNode, 'callee') && Predicate.hasProperty(callNode, 'arguments')
}

function nodeArgumentArrayOf(argument: unknown): Option.Option<readonly Node[]> {
  return Option.filter(Option.some(argument), isNodeArray)
}

function isNodeArray(value: unknown): value is readonly Node[] {
  return Array.isArray(value)
}

function signalIoArgumentIndex(callee: unknown): Option.Option<number> {
  return Match.value(callee).pipe(
    Match.when(isRequiredSignalIoCall, () => Option.some(0)),
    Match.when(isOutputCall, () => Option.some(0)),
    Match.when(isSignalIoCall, () => Option.some(1)),
    Match.orElse(() => Option.none<number>()),
  )
}

function isRequiredSignalIoCall(callee: unknown): boolean {
  return isMemberExpressionWithIdentifier(callee, ANGULAR_SIGNAL_IO_FUNCTIONS, 'required')
}

function isOutputCall(callee: unknown): boolean {
  return isIdentifierWithName(callee, 'output')
}

function isSignalIoCall(callee: unknown): boolean {
  return isIdentifierIn(callee, ANGULAR_SIGNAL_IO_FUNCTIONS)
}

function isSignalQueryCall(callee: unknown): boolean {
  return isIdentifierIn(callee, ANGULAR_SIGNAL_QUERY_FUNCTIONS) ||
    isMemberExpressionWithIdentifier(callee, ANGULAR_SIGNAL_QUERY_FUNCTIONS, 'required')
}

function isArgumentAt(site: SignalCallSite, index: Option.Option<number>): boolean {
  return Option.exists(
    index,
    (position) => site.args.length > position && site.args[position] === site.objectExpression,
  )
}

function isIdentifierWithName(node: unknown, name: string): boolean {
  return Option.contains(identifierName(node), name)
}

function isIdentifierIn(node: unknown, names: readonly string[]): boolean {
  return Option.exists(identifierName(node), (name) => names.includes(name))
}

function identifierName(node: unknown): Option.Option<string> {
  return Option.map(identifierNode(node), (identifier) => identifier.name)
}

function identifierNode(node: unknown): Option.Option<{ readonly name: string }> {
  return Option.filter(Option.some(node), isNamedIdentifier)
}

function isNamedIdentifier(node: unknown): node is { readonly name: string } {
  return hasNodeType(node, 'Identifier') && isStringProperty(node, 'name')
}

function hasNodeType(node: unknown, type: string): boolean {
  return Predicate.hasProperty(node, 'type') && node['type'] === type
}

function isStringProperty(node: unknown, property: string): boolean {
  return Predicate.hasProperty(node, property) && typeof node[property] === 'string'
}

function isMemberExpressionWithIdentifier(
  node: unknown,
  objectNames: readonly string[],
  propertyName: string,
): boolean {
  return Option.exists(
    memberPartsOf(node),
    (member) => isIdentifierIn(member.object, objectNames) && isIdentifierWithName(member.property, propertyName),
  )
}

interface MemberParts {
  readonly object: unknown
  readonly property: unknown
}

function memberPartsOf(node: unknown): Option.Option<MemberParts> {
  return Option.filter(Option.some(node), isMemberExpressionRecord)
}

function isMemberExpressionRecord(node: unknown): node is MemberParts {
  return hasNodeType(node, 'MemberExpression') && isPropertyBearing(node)
}

function isPropertyBearing(node: unknown): node is { readonly object: unknown; readonly property: unknown } {
  return Predicate.hasProperty(node, 'object') && Predicate.hasProperty(node, 'property')
}

function nodeType(node: unknown): string | undefined {
  if (!isAstNode(node)) {
    return undefined
  }
  return node.type
}

function isAstNode(value: unknown): value is { readonly type: string } {
  return Predicate.isObject(value) && typeof value['type'] === 'string'
}
