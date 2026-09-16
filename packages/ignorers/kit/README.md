# @systemfsoftware/stryker-ignorer-kit

Authoring and testing kit for the Stryker ignorer family: write an ignorer as
typed visitors, verify it from source snippets.

An **ignorer** tells the mutation engine which code to leave alone. The engine
consults every configured ignorer at each mutant candidate node; returning a
reason string suppresses that node's mutants, `undefined` declines. This kit
supplies the two layers an author actually works in — the authoring API
(`defineIgnorer`) and the testing harness (`testIgnorer`) — and compiles down to
the plain `{ name, shouldIgnore }` wire contract the engine loads.

## Write a new ignorer from scratch

### 1. The package

Create `packages/ignorers/<your-ignorer>/` (the workspace glob picks it up) with
the family tooling set cloned from a sibling, and these dependencies:

```json
{
  "dependencies": {
    "@systemfsoftware/stryker-ignorer-interface": "workspace:^",
    "@systemfsoftware/stryker-ignorer-kit": "workspace:^"
  }
}
```

The interface package is types only (the AST vocabulary); the kit's root entry
is parser-free. Your module exports one array:

```ts
export const strykerIgnorers = [myIgnorer]
```

Consumers wire the pair in their Stryker config — `plugins` takes the module
specifier, `ignorers` the ignorer's own name (`myIgnorer`'s `name`); a mismatched
pair fails silent-green, so keep the two strings in step.

### 2. The visitors

`defineIgnorer` takes a visitor map keyed by AST node kind. Each visitor receives
its node **narrowed to that kind** plus a typed context for the ancestor chain,
and returns a reason string or `undefined` to decline:

```ts
import type { CallExpression, Expression, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { defineIgnorer } from '@systemfsoftware/stryker-ignorer-kit'

export const INSIDE_TRACE = 'inside `logger.trace(...)` — diagnostic noise, not production behaviour'
export const METRIC_NAME = 'a metric name — mutating it only renames telemetry'

function isTraceCallee(callee: Expression): boolean {
  return callee.type === 'MemberExpression' && !callee.computed &&
    callee.object.type === 'Identifier' && callee.object.name === 'logger' &&
    callee.property.type === 'Identifier' && callee.property.name === 'trace'
}

function isLoggerTrace(node: Node): boolean {
  return node.type === 'CallExpression' && isTraceCallee(node.callee)
}

function isMetricCounter(call: CallExpression): boolean {
  return call.callee.type === 'MemberExpression' && !call.callee.computed &&
    call.callee.object.type === 'Identifier' && call.callee.object.name === 'metrics' &&
    call.callee.property.type === 'Identifier' && call.callee.property.name === 'counter'
}

export const strykerIgnorers = [
  defineIgnorer({
    name: 'telemetry-calls',
    visitors: {
      // Point rule: the metric-name argument itself.
      Literal: (node, ctx) => {
        const call = ctx.parentIf('CallExpression')
        return call !== undefined && isMetricCounter(call) && call.arguments[0] === node
          ? METRIC_NAME
          : undefined
      },
      // Subtree rule: everything evaluated inside a logger.trace call.
      onAnyNode: (_node, ctx) => (ctx.ancestors.some(isLoggerTrace) ? INSIDE_TRACE : undefined),
    },
  }),
]
```

The context, nearest-first:

| Member                 | Meaning                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `ctx.ancestors`        | the raw chain, parent first, root last, excluding the visited node |
| `ctx.parentIf(kind)`   | the immediate parent narrowed to `kind`, else `undefined`          |
| `ctx.ancestorIf(kind)` | the nearest chain member of `kind`, else `undefined`               |

Keys are ESTree discriminants: string, number, and boolean literals all arrive as
`'Literal'` (narrow further on `typeof node.value`), not `'StringLiteral'`.
A visitor returning `undefined` falls through to `onAnyNode`; a node no typed
visitor claims goes straight there.

### 3. The tests

`testIgnorer` (from the `./tester` entry) parses your snippets with the same
parser convention the instrumenter uses, walks them with host-shaped ancestor
semantics, and consults your ignorer at every node. One runner test is registered
per case:

```ts
import { testIgnorer } from '@systemfsoftware/stryker-ignorer-kit/tester'
import { strykerIgnorers } from '../src/mod.js'

await testIgnorer(strykerIgnorers[0], {
  kept: [
    { name: 'ordinary call', code: 'const client = createClient(host)' },
    { name: 'logger.info still mutates', code: 'logger.info("ready")' },
  ],
  ignored: [
    {
      name: 'metric name',
      code: 'metrics.counter("requests")',
      ignores: [{ text: '"requests"', reason: METRIC_NAME }],
    },
    {
      name: 'everything under logger.trace',
      code: 'logger.trace(sum(a, b))',
      ignores: ['sum(a, b)', 'a', 'b'],
    },
  ],
})
```

Case semantics:

- **kept** — no node in the snippet may yield a reason.
- **ignored** — each expectation must match a _distinct_ ignored span (multiset);
  extra ignored spans do not fail (containment, not totality).
- Spans are source-text slices, quotes included: the string literal in
  `metrics.counter("requests")` is `"requests"`, not `requests`.
- A bare string expectation matches on text; `{ text, reason }` pins the reason.
- `lang` defaults to `ts`; override per case (`js`, `jsx`, `tsx`).
- A failing case throws an enumeration of its snippet, expectations, and received
  spans (text, node type, reason). Where no runner globals exist, `testIgnorer`
  runs every case and throws one aggregate error naming all failures.
- `keeps` (either case kind) names spans that must **stay live** even when siblings in the
  same snippet are ignored — for rows that pin one node's liveness inside a partly-ignored
  expression. A kept case without `keeps` still asserts nothing at all is ignored.

### 4. Ship it

`pnpm --filter <your-package> test` green, `api:update` for the report, a
changeset entry, and the AGENTS/README wording true to what ships. The family
rules bind: zero Effect, no type assertions, complexity ≤ 2 per function —
narrow with small type-predicate functions, as above.

## Semantics worth knowing

- The engine consults ignorers **per mutant candidate**, point-only: a reason on
  node X suppresses X's mutants; descendants are visited and re-judged on their
  own. Subtree behaviour therefore comes from scanning `ctx.ancestors`, never
  from pruning.
- Ancestor chains are **nearest-first**: `ancestors[0]` is the parent.
- Stryker `StrykerIgnore`/`Restore` directives and `excludedMutations` win before
  any ignorer is asked; among ignorers, the first reason in configured order wins.
- The tester walks every node (a superset of host consultation), so a green suite
  pins your decision policy; host consult policy stays pinned by the engine and
  instrumenter suites.

## API reference

| Export                                                                     | Entry      | What it is                                                                 |
| -------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------- |
| `defineIgnorer(definition)`                                                | `.`        | compiles `{ name, visitors }` to the `Ignorer` wire contract               |
| `IgnorerVisitors`, `IgnorerVisitor`, `IgnorerContext`, `IgnorerDefinition` | `.`        | authoring types                                                            |
| `testIgnorer(subject, cases)`                                              | `./tester` | snippet harness; one test per case, aggregate throw without runner globals |
| `IgnorerCases`, `IgnoredCase`, `KeptCase`, `IgnoredSpan`, `ScriptLang`     | `./tester` | case types                                                                 |

## License

[Apache 2.0](LICENSE)
