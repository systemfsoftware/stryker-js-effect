import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'

export interface IgnorerContext {
  /** Nearest-first as the host hands it over; the parent is the first element. */
  readonly ancestors: readonly Node[]
  parentIf<K extends Node['type']>(kind: K): Extract<Node, { readonly type: K }> | undefined
  ancestorIf<K extends Node['type']>(kind: K): Extract<Node, { readonly type: K }> | undefined
}

export type IgnorerVisitor<K extends Node['type']> = (
  node: Extract<Node, { readonly type: K }>,
  ctx: IgnorerContext,
) => string | undefined

export type IgnorerVisitors =
  & {
    readonly [K in Node['type']]?: IgnorerVisitor<K>
  }
  & {
    readonly onAnyNode?: (node: Node, ctx: IgnorerContext) => string | undefined
  }

export interface IgnorerDefinition {
  readonly name: string
  readonly visitors: IgnorerVisitors
}

type AnyVisitor = (node: Node, ctx: IgnorerContext) => string | undefined

const isNodeOfType = <K extends Node['type']>(
  node: Node | undefined,
  kind: K,
): node is Extract<Node, { readonly type: K }> => node !== undefined && node.type === kind

const isVisitor = (value: unknown): value is AnyVisitor => typeof value === 'function'

const typedVisitorOf = (visitors: IgnorerVisitors, node: Node) => {
  const entry: unknown = visitors[node.type]
  return [entry].find(isVisitor)
}

const claimedReasonOf = (visitors: IgnorerVisitors, node: Node, ctx: IgnorerContext) => {
  const visit = typedVisitorOf(visitors, node)
  return visit === undefined ? undefined : visit(node, ctx)
}

const anyReasonOf = (visitors: IgnorerVisitors, node: Node, ctx: IgnorerContext) =>
  visitors.onAnyNode?.(node, ctx)

const reasonFrom = (visitors: IgnorerVisitors, node: Node, ctx: IgnorerContext) => {
  const claimed = claimedReasonOf(visitors, node, ctx)
  return claimed === undefined ? anyReasonOf(visitors, node, ctx) : claimed
}

export function defineIgnorer(definition: IgnorerDefinition): Ignorer {
  return {
    name: definition.name,
    shouldIgnore: (node, ancestors) =>
      reasonFrom(definition.visitors, node, {
        ancestors,
        parentIf: (kind) => (isNodeOfType(ancestors[0], kind) ? ancestors[0] : undefined),
        ancestorIf: (kind) => ancestors.find((ancestor) => isNodeOfType(ancestor, kind)),
      }),
  }
}
