import type { Ignorer, Node, Walker, WalkVisitors } from '@systemfsoftware/stryker-ignorer-interface'
import { expectTypeOf } from 'vitest'

expectTypeOf<Ignorer['name']>().toEqualTypeOf<string>()
expectTypeOf<Ignorer['shouldIgnore']>().toEqualTypeOf<(node: Node, ancestors: readonly Node[]) => string | undefined>()
expectTypeOf<Walker>().toEqualTypeOf<(root: Node, visitors: WalkVisitors) => void>()
expectTypeOf<WalkVisitors['enter']>().toEqualTypeOf<((node: Node, ancestors: readonly Node[]) => void) | undefined>()
expectTypeOf<WalkVisitors['leave']>().toEqualTypeOf<((node: Node, ancestors: readonly Node[]) => void) | undefined>()
