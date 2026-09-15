import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer } from '@systemfsoftware/stryker-ignorer-kit'
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
        expectTypeOf(ctx.parentIf('IfStatement')).toExtend<{ readonly type: 'IfStatement' } | undefined>()
        expectTypeOf(ctx.ancestorIf('IfStatement')).toExtend<{ readonly type: 'IfStatement' } | undefined>()
        return undefined
      },
    },
  })
  expectTypeOf(probe).toExtend<Ignorer>()
})

test('a visitor key that is not a node kind is refused', () => {
  expectTypeOf(defineIgnorer({
    name: 'bad-key-probe',
    visitors: {
      // @ts-expect-error a visitor key must be a Node['type'] member — a typo must not compile
      LiteralX: () => 'R',
    },
  })).toExtend<Ignorer>()
})
