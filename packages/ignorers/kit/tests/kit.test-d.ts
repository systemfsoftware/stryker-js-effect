import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer } from '@systemfsoftware/stryker-ignorer-kit'
import { type ScriptLang } from '@systemfsoftware/stryker-ignorer-kit/tester'
import { expectTypeOf } from 'vitest'

expectTypeOf<ScriptLang>().toEqualTypeOf<'js' | 'jsx' | 'ts' | 'tsx'>()

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

expectTypeOf(defineIgnorer({
  name: 'bad-key-probe',
  visitors: {
    // @ts-expect-error a visitor key must be a Node['type'] member — a typo must not compile
    LiteralX: () => 'R',
  },
})).toExtend<Ignorer>()
