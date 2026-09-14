# @systemfsoftware/stryker-ignorer-interface

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-ignorer-interface)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-ignorer-interface)

> The ignorer interface: declare the AST shape your rule reasons about as a Standard Schema, and ship a plain module with zero runtime dependencies.

An ignorer is the smallest thing a StrykerJS-style mutation tool can load: a
name and a synchronous decision over a path the host hands it. This
package carries the whole author-facing surface — the schema toolkit, the node
vocabulary, and the ancestor walk. It has **no**
Effect dependency**, runtime or development: `dependencies` is empty, and the
kitchen-sink family aggregate preset is replaced by
`@systemfsoftware/oxlint-ignorer-config`, which bans Effect imports outright.

| Export                       | What it is                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlainIgnorer`               | The descriptor: `{ name, shouldIgnore(path): string \| undefined }`                                                                                                                                                                                                                                                                |
| `StandardSchemaV1`           | The [Standard Schema](https://standardschema.dev) types, imported from `@standard-schema/spec` and inlined into this package's published types                                                                                                                                                                                     |
| toolkit                      | `string`, `literal`, `literals`, `unknown`, `struct`, `union`, `array`, `nonEmptyArray`, `optional`, `nullable`, `declared`, `suspend`, `is`, `validate`                                                                                                                                                                           |
| vocabulary                   | the canonical ESTree kinds — `Identifier`, `StringLiteral`, `ObjectExpression`, `Property`, `ArrowFunctionExpression`, `FunctionExpression`, `MemberExpression`, `CallExpression`, `MetaProperty`, `BinaryExpression`, `IfStatement`, `ImportSpecifier`, `ImportNamespaceSpecifier`, `ImportDeclaration`, `Program`, `UnknownNode` |
| predicates                   | one `is*` per kind, plus `AstNode`/`AstNodeType` over all sixteen                                                                                                                                                                                                                                                                  |
| `NodePath`, `NodePathSchema` | the path shape the host hands `shouldIgnore`, and its validator                                                                                                                                                                                                                                                                    |
| `ancestorsOf`                | the nearest-first ancestor walk over a `NodePath`                                                                                                                                                                                                                                                                                  |

A toolkit schema is a real `StandardSchemaV1` value: `struct` is inexact, so a
host node carrying members this rule does not model still validates; `suspend`
gives a self-referential schema a fixed recursion budget (`maxDepth`, default
`6`) and reports issues past it instead of descending further. Validators are
synchronous — the toolkit composes them directly rather than through a promise.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-ignorer-interface
```

## Write an ignorer

```ts
import {
  ancestorsOf,
  isIdentifier,
  isMemberExpression,
  type PlainIgnorer,
} from '@systemfsoftware/stryker-ignorer-interface'

const isGenerated = (node: unknown): boolean =>
  isMemberExpression(node) && isIdentifier(node.object) && node.object.name === '__generated'

const myIgnorer: PlainIgnorer = {
  name: 'generated-code',
  shouldIgnore: (path) => [...ancestorsOf(path)].some(isGenerated) ? 'the enclosing member is generated' : undefined,
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
