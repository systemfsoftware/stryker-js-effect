# @systemfsoftware/stryker-ignorer-interface

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-ignorer-interface)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-ignorer-interface)

> The ignorer interface: the descriptor and the AST vocabulary an ignorer reasons
> about, as types only — the package ships no runtime code.

An ignorer is the smallest thing a StrykerJS-style mutation tool can load: a
name and a synchronous decision over a path the host hands it. This package
carries the shapes of that contract and nothing that runs. It has **no** Effect
dependency, runtime or development: `dependencies` is empty, no value is
exported, and the kitchen-sink family aggregate preset is replaced by
`@systemfsoftware/oxlint-ignorer-config`, which bans Effect imports outright.

| Export         | What it is                                                                                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlainIgnorer` | The descriptor: `{ name, shouldIgnore(path): string \| undefined }`                                                                                                                                                                                                                           |
| vocabulary     | the AST vocabulary, re-exported from [`@oxc-project/types`](https://www.npmjs.com/package/@oxc-project/types) and bundled into this package's own declarations, so a consumer installs nothing else — `Node`, `Expression`, `Statement`, `Program`, `Span`, and every concrete node interface |
| `NodePath`     | the path shape the host hands `shouldIgnore`: the node and its ancestors, nearest first                                                                                                                                                                                                       |

Everything the package publishes is a type. A guard and a reason string are the
ignorer's own code: the host never interprets a schema, it calls
`shouldIgnore(path)` and uses what comes back.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-ignorer-interface
```

## Write an ignorer

```ts
import type { NodePath, PlainIgnorer } from '@systemfsoftware/stryker-ignorer-interface'

const isGenerated = (node: unknown): boolean =>
  typeof node === 'object' && node !== null && 'name' in node && node.name === '__generated'

const inGeneratedCode = (path: NodePath): boolean => path.ancestors.some(isGenerated)

const myIgnorer: PlainIgnorer = {
  name: 'generated-code',
  shouldIgnore: (path) => (inGeneratedCode(path) ? 'the enclosing member is generated' : undefined),
}

export const strykerIgnorers = [myIgnorer]
```

An entry is just `{ name, shouldIgnore }`: the host registers each one as an
`Ignore` contribution and validates at load that `name` is a string and
`shouldIgnore` is callable — an entry that fails fails the load by name.

A module exporting `strykerIgnorers` loads as `Ignore` plugin contributions in
any engine carrying the plain-ignorer loader. Configure the pair — they take
different strings:

| Config key | Value                                           |
| ---------- | ----------------------------------------------- |
| `plugins`  | the module specifier (this package or your own) |
| `ignorers` | the contribution name (`generated-code` above)  |

A mismatched pair fails silent-green: the run completes with nothing ignored
and only a `Cannot find plugin` warning.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
