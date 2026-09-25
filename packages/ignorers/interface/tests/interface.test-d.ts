import type { Ignorer, Node, WalkVisitors } from '@systemfsoftware/stryker-ignorer-interface'
import { expectTypeOf } from '@systemfsoftware/vitest'
import { test } from 'vitest'

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

test('a boolean reason is not the accepted channel', () => {
  expectTypeOf<(node: Node, ancestors: readonly Node[]) => boolean>().not.toEqualTypeOf<
    Ignorer['shouldIgnore']
  >()
})

test('a visitor consuming a bare string is not the accepted enter shape', () => {
  expectTypeOf<(text: string) => void>().not.toEqualTypeOf<NonNullable<WalkVisitors['enter']>>()
})

test('a visitor may omit leave', () => {
  const partial: WalkVisitors = { enter: () => undefined }
  expectTypeOf(partial).toExtend<WalkVisitors>()
})

test('a node narrowed by its discriminant exposes the fields of its kind', () => {
  type IfNode = Extract<Node, { readonly type: 'IfStatement' }>
  expectTypeOf<IfNode['test']>().toExtend<{ readonly type: string }>()
})
