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

function makeContext(ancestors: readonly Node[]): IgnorerContext {
  return {
    ancestors,
    parentIf: (kind) =>
      ancestors.slice(0, 1).find((ancestor): ancestor is Extract<Node, { readonly type: typeof kind }> =>
        ancestor.type === kind
      ),
    ancestorIf: (kind) =>
      ancestors.find((ancestor): ancestor is Extract<Node, { readonly type: typeof kind }> => ancestor.type === kind),
  }
}

function isVisitor(value: unknown): value is AnyVisitor {
  return typeof value === 'function'
}

// Soundness: the map is keyed by the same `type` field this dispatch reads, so the entry
// stored under `node.type` only ever receives nodes of that kind; the predicate confirms
// callability while the key supplies the kind.
function typedVisitor(visitors: IgnorerVisitors, node: Node): AnyVisitor | undefined {
  const entry: unknown = visitors[node.type]
  return isVisitor(entry) ? entry : undefined
}

function callTyped(visitors: IgnorerVisitors, node: Node, ctx: IgnorerContext): string | undefined {
  const visit = typedVisitor(visitors, node)
  return visit === undefined ? undefined : visit(node, ctx)
}

function callAny(visitors: IgnorerVisitors, node: Node, ctx: IgnorerContext): string | undefined {
  return visitors.onAnyNode?.(node, ctx)
}

function decide(visitors: IgnorerVisitors, node: Node, ctx: IgnorerContext): string | undefined {
  const reason = callTyped(visitors, node, ctx)
  return reason === undefined ? callAny(visitors, node, ctx) : reason
}

export function defineIgnorer(definition: IgnorerDefinition): Ignorer {
  const visitors = definition.visitors
  return {
    name: definition.name,
    shouldIgnore: (node, ancestors) => decide(visitors, node, makeContext(ancestors)),
  }
}
