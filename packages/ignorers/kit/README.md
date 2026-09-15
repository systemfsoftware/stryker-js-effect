# @systemfsoftware/stryker-ignorer-kit

Authoring and testing kit for Stryker ignorers.

## Authoring

`defineIgnorer` compiles a visitor map — keyed by AST node type, with an `onAnyNode`
fallback — into the plain `Ignorer` wire contract the Stryker engine loads. Each visitor
receives its node narrowed to the key's kind plus a typed context for the ancestor chain:

```ts
import { defineIgnorer } from '@systemfsoftware/stryker-ignorer-kit'

export const strykerIgnorers = [
  defineIgnorer({
    name: 'my-ignorer',
    visitors: {
      Literal: (node, ctx) => {
        const call = ctx.parentIf('CallExpression')
        return typeof node.value === 'string' && call !== undefined && isSymbolFor(call) && call.arguments[0] === node
          ? MY_REASON
          : undefined
      },
      onAnyNode: (_node, ctx) => ctx.ancestorIf('IfStatement')?.test.type === 'MetaProperty' ? MY_REASON : undefined,
    },
  }),
]
```

`ctx.parentIf(kind)` reads the immediate parent; `ctx.ancestorIf(kind)` scans the chain
nearest-first; `ctx.ancestors` exposes the raw chain. A visitor returning `undefined`
declines and falls through to `onAnyNode`.

## Testing

`testIgnorer` (from `@systemfsoftware/stryker-ignorer-kit/tester`) parses source snippets
with the same parser convention the instrumenter uses, walks them with host-shaped ancestor
semantics, and registers one test per case through the detected runner globals:

```ts
import { testIgnorer } from '@systemfsoftware/stryker-ignorer-kit/tester'
import { strykerIgnorers } from '../src/mod.js'

await testIgnorer(strykerIgnorers[0], {
  ignored: [
    { name: 'schema description', code: 'Schema.Tag("Id")', ignores: [{ text: '"Id"', reason: MY_REASON }] },
  ],
  kept: [{ name: 'ordinary call', code: 'foo("bar")' }],
})
```

Ignored cases assert named spans (source text, optionally a reason) against distinct ignored
nodes — containment, not the exhaustive ignored set. Kept cases assert nothing is ignored.
Where no runner globals exist, the entry throws one aggregate error enumerating every
failing case.
