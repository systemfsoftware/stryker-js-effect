# @systemfsoftware/stryker-ignorer-interface

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-ignorer-interface)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-ignorer-interface)

> The ignorer interface: the descriptor and the AST vocabulary an ignorer reasons
> about, as types only — the package ships no runtime code.

An ignorer is the smallest thing a StrykerJS-style mutation tool can load: a
name and a synchronous decision over the node the host hands it, together with
that node's ancestors. This package carries the shapes of that contract and
nothing that runs. It has **no** Effect dependency, runtime or development:
`dependencies` is empty, no value is exported, and the kitchen-sink family
aggregate preset is replaced by `@systemfsoftware/oxlint-ignorer-config`, which
bans Effect imports outright.

| Export     | What it is                                                                                                                                                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ignorer`  | The descriptor: `{ name, shouldIgnore(node, ancestors): string \| undefined }` — the node and its ancestors as typed positions, nearest first                                                                                                                                                                     |
| vocabulary | the AST vocabulary, re-exported from [`@oxc-project/types`](https://www.npmjs.com/package/@oxc-project/types) with optional spans and bundled into this package's own declarations, so a consumer installs nothing else — `Node`, `Expression`, `Statement`, `Program`, `Span`, and every concrete node interface |
| `Walker`   | the traversal shape a host implements: `enter`/`leave` receive each node and its ancestor stack — see the instrumenter's walker for the reference implementation over `oxc-walker`                                                                                                                                |

Everything the package publishes is a type. A guard and a reason string are the
ignorer's own code: the host never interprets a schema, it calls
`shouldIgnore(node, ancestors)` and uses what comes back.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-ignorer-interface
```

## Write an ignorer

The authoring and testing kit — [`@systemfsoftware/stryker-ignorer-kit`](../kit/README.md) —
is the from-scratch path: typed visitors via `defineIgnorer`, snippet cases via
`testIgnorer`. The plain descriptor below is the wire contract the kit compiles
to; reach for it directly only when the kit cannot express your rule.

```ts
import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'

const isGenerated = (node: Node): boolean => 'name' in node && node.name === '__generated'

const myIgnorer: Ignorer = {
  name: 'generated-code',
  shouldIgnore: (node, ancestors) =>
    isGenerated(node) || ancestors.some(isGenerated) ? 'the enclosing member is generated' : undefined,
}

export const strykerIgnorers = [myIgnorer]
```

An entry is just `{ name, shouldIgnore }`: the host carries each one as that
plain descriptor and validates at load that `name` is a string and
`shouldIgnore` is callable — an entry that fails fails the load by name.

A module exporting `strykerIgnorers` loads in any engine carrying the plain-ignorer
loader, and the host builds the ignorer it runs from the descriptor. Configure the
pair — they take different strings:

| Config key | Value                                           |
| ---------- | ----------------------------------------------- |
| `plugins`  | the module specifier (this package or your own) |
| `ignorers` | the ignorer name (`generated-code` above)       |

A mismatched pair fails silent-green: the run completes with nothing ignored
and only a `Cannot find plugin` warning.

## License

[Apache 2.0](LICENSE)
