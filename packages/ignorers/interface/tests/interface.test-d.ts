import type { Ignorer, Node, WalkVisitors } from '@systemfsoftware/stryker-ignorer-interface'
import { expectTypeOf, test } from 'vitest'

test('the reason channel is exactly a string or undefined', () => {
  expectTypeOf<Ignorer['shouldIgnore']>().toEqualTypeOf<
    (node: Node, ancestors: readonly Node[]) => string | undefined
  >()
})

test('an implementation receives the node and its ancestors, and its reason is accepted', () => {
  const consumer: Ignorer = {
    name: 'consumer-probe',
    shouldIgnore: (node, ancestors) => {
      expectTypeOf(ancestors).toEqualTypeOf<readonly Node[]>()
      return node.type
    },
  }
  expectTypeOf(consumer).toExtend<Ignorer>()
})

test('a boolean reason is refused', () => {
  // @ts-expect-error a boolean is not a reason — the channel is string | undefined
  const refused: Ignorer = { name: 'refused', shouldIgnore: () => true }
  expectTypeOf(refused).toExtend<Ignorer>()
})

test('a visitor parameter that is not a node is refused', () => {
  const loose: WalkVisitors = {
    // @ts-expect-error visitors receive the node and its ancestors, not a bare string
    enter: (text: string) => {
      void text
    },
  }
  expectTypeOf(loose).toExtend<WalkVisitors>()
})

test('a visitor may omit leave', () => {
  const partial: WalkVisitors = { enter: () => undefined }
  expectTypeOf(partial).toExtend<WalkVisitors>()
})

test('a node narrowed by its discriminant exposes the fields of its kind', () => {
  type IfNode = Extract<Node, { readonly type: 'IfStatement' }>
  expectTypeOf<IfNode['test']>().toExtend<{ readonly type: string }>()
})
