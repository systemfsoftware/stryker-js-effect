import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer, type IgnorerVisitors } from '@systemfsoftware/stryker-ignorer-kit'
import { type ScriptLang } from '@systemfsoftware/stryker-ignorer-kit/tester'
import { expectTypeOf, test } from 'vitest'

test('a script language is one of the four the parser is driven with', () => {
  expectTypeOf<ScriptLang>().toEqualTypeOf<'js' | 'jsx' | 'ts' | 'tsx'>()
})

test('a typed visitor gets a context narrowed to the kind it is keyed for', () => {
  const probe = defineIgnorer({
    name: 'type-probe',
    visitors: {
      IfStatement: (_node, ctx) => {
        expectTypeOf(ctx.parentIf('IfStatement')).toEqualTypeOf<
          Extract<Node, { readonly type: 'IfStatement' }> | undefined
        >()
        expectTypeOf(ctx.ancestorIf('IfStatement')).toEqualTypeOf<
          Extract<Node, { readonly type: 'IfStatement' }> | undefined
        >()
        return undefined
      },
    },
  })
  expectTypeOf(probe).toExtend<Ignorer>()
})

test('visitor keys are exactly the node kinds plus the onAnyNode escape hatch', () => {
  expectTypeOf<keyof IgnorerVisitors>().toEqualTypeOf<Node['type'] | 'onAnyNode'>()
})
