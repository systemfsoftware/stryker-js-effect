---
content_hash: c4237f
---

# Custom Ignorer Authoring Guide

An **ignorer** suppresses synthetic mutants on code where mutations change syntax but cannot alter runtime behavior (e.g., brand types, schema annotations, logging calls).

In Stryker JS Effect, custom ignorers are written with `@systemfsoftware/stryker-ignorer-kit` using typed AST visitors over the OXC parser.

---

## 1. Package Setup

Create your ignorer package (or place it in a local directory) with these dependencies:

```json
{
  "dependencies": {
    "@systemfsoftware/stryker-ignorer-interface": "workspace:^",
    "@systemfsoftware/stryker-ignorer-kit": "workspace:^"
  }
}
```

- `@systemfsoftware/stryker-ignorer-interface`: Provides TypeScript types for AST nodes and the `Ignorer` contract.
- `@systemfsoftware/stryker-ignorer-kit`: Provides the `defineIgnorer` helper and the testing harness (`testIgnorer`).

---

## 2. Writing Visitors (`defineIgnorer`)

An ignorer exports `strykerIgnorers`, an array of ignorer definitions. Each visitor function checks a node kind and returns:

- A `string` describing **why** the mutant is ignored.
- `undefined` to leave the node alone and let Stryker mutate it.

```ts
import type { CallExpression, Expression, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer } from '@systemfsoftware/stryker-ignorer-kit'

export const METRIC_CALL = 'metrics.counter() call — mutating does not affect runtime business logic'

function isMetricCall(node: Node): boolean {
  return node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'metrics'
}

export const strykerIgnorers = [
  defineIgnorer({
    name: 'custom-metric-ignorer',
    visitors: {
      // 1. Target specific node types directly
      CallExpression: (node, ctx) => {
        if (isMetricCall(node)) {
          return METRIC_CALL
        }
        return undefined
      },
      // 2. Subtree rule: inspect ancestors to ignore children of a call
      onAnyNode: (node, ctx) => {
        if (ctx.ancestors.some(isMetricCall)) {
          return METRIC_CALL
        }
        return undefined
      },
    },
  }),
]
```

### The `IgnorerContext` Object

The visitor context (`ctx`) provides navigation through the AST ancestor chain:

| Member                 | Type                | Description                                                                  |
| ---------------------- | ------------------- | ---------------------------------------------------------------------------- |
| `ctx.ancestors`        | `readonly Node[]`   | Immediate ancestors, nearest-first (`ancestors[0]` is parent, last is root). |
| `ctx.parentIf(kind)`   | `Node \| undefined` | Returns the immediate parent narrowed to `kind`, or `undefined`.             |
| `ctx.ancestorIf(kind)` | `Node \| undefined` | Returns the nearest ancestor matching `kind`, or `undefined`.                |

---

## 3. Testing with `@systemfsoftware/stryker-ignorer-kit/tester`

The tester walks code snippets through the OXC parser and verifies exact ignored spans and reasons:

```ts
import { testIgnorer } from '@systemfsoftware/stryker-ignorer-kit/tester'
import { METRIC_CALL, strykerIgnorers } from './my-ignorer.ts'

await testIgnorer(strykerIgnorers[0], {
  kept: [
    { name: 'business function call', code: 'calculateTax(amount, rate)' },
  ],
  ignored: [
    {
      name: 'metric counter call',
      code: 'metrics.counter("requests_total")',
      ignores: [
        { text: 'metrics.counter("requests_total")', reason: METRIC_CALL },
      ],
    },
  ],
})
```

---

## 4. Registering in `stryker.config.ts`

In your `stryker.config.ts`, declare the plugin module URL in `plugins` and its `name` in `ignorers`:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  plugins: [
    import.meta.resolve('./packages/my-custom-ignorer/dist/index.js'),
  ],
  ignorers: [
    'custom-metric-ignorer',
  ],
})
```
