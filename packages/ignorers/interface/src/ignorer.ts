import type { Node } from './node.js'

export interface Ignorer {
  readonly name: string
  shouldIgnore(node: Node, ancestors: readonly Node[]): string | undefined
}

export interface WalkVisitors {
  enter?(node: Node, ancestors: readonly Node[]): void
  leave?(node: Node, ancestors: readonly Node[]): void
}

export type Walker = (root: Node, visitors: WalkVisitors) => void
