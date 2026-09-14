# @systemfsoftware/stryker-ignorer-interface

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-ignorer-interface)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-ignorer-interface)

> The ignorer interface: declare the AST shape your rule reasons about as a Standard Schema, and ship a plain module with zero runtime dependencies.

An ignorer is the smallest thing a StrykerJS-style mutation tool can load: a
name, the shape of the input it decides over, and a synchronous decision. This
package carries the whole author-facing surface — the schema toolkit, the node
vocabulary, the ancestor walk, and a case-table test harness. It has **no
Effect dependency**, runtime or development: `dependencies` is empty, and the
kitchen-sink `@systemfsoftware/all` preset is replaced by
`@systemfsoftware/oxlint-ignorer-config`, which bans Effect imports outright.

| Export                       | What it is                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlainIgnorer`               | The descriptor: `{ name, schema, shouldIgnore(path): string \| undefined }`                                                                                                                                                                                                                                                        |
| `PlainIgnorerSchema`         | The validator the host decodes a loaded module entry with                                                                                                                                                                                                                                                                          |
| `StandardSchemaV1`           | The [Standard Schema](https://standardschema.dev) types, vendored so this package needs no dependency to declare them                                                                                                                                                                                                              |
| toolkit                      | `string`, `literal`, `literals`, `unknown`, `struct`, `union`, `array`, `nonEmptyArray`, `optional`, `nullable`, `declared`, `suspend`, `is`, `validate`                                                                                                                                                                           |
| vocabulary                   | the canonical ESTree kinds — `Identifier`, `StringLiteral`, `ObjectExpression`, `Property`, `ArrowFunctionExpression`, `FunctionExpression`, `MemberExpression`, `CallExpression`, `MetaProperty`, `BinaryExpression`, `IfStatement`, `ImportSpecifier`, `ImportNamespaceSpecifier`, `ImportDeclaration`, `Program`, `UnknownNode` |
| predicates                   | one `is*` per kind, plus `AstNode`/`AstNodeType` over all sixteen                                                                                                                                                                                                                                                                  |
| `NodePath`, `NodePathSchema` | the path shape the host hands `shouldIgnore`, and its validator                                                                                                                                                                                                                                                                    |
| `ancestorsOf`                | the nearest-first ancestor walk over a `NodePath`                                                                                                                                                                                                                                                                                  |
| `IgnoreTester` (`./testing`) | the case-table harness: a descriptor check, a schema check per case, then the decision                                                                                                                                                                                                                                             |

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
  literal,
  type PlainIgnorer,
  struct,
} from '@systemfsoftware/stryker-ignorer-interface'

const GeneratedNamespace = struct({
  type: literal('MemberExpression'),
  object: struct({ type: literal('Identifier'), name: literal('__generated') }),
})

const isGenerated = (node: unknown): boolean =>
  isMemberExpression(node) && isIdentifier(node.object) && node.object.name === '__generated'

const myIgnorer: PlainIgnorer = {
  name: 'generated-code',
  schema: GeneratedNamespace,
  shouldIgnore: (path) => [...ancestorsOf(path)].some(isGenerated) ? 'the enclosing member is generated' : undefined,
}

export const strykerIgnorers = [myIgnorer]
```

`schema` is required: the host decodes every loaded entry against
`PlainIgnorerSchema` once, and a module whose entry declares no usable schema
fails to load by name instead of silently ignoring nothing.

A module exporting `strykerIgnorers` loads as `Ignore` plugin contributions in
any engine carrying the plain-ignorer loader. Configure the pair — they take
different strings:

| Config key | Value                                           |
| ---------- | ----------------------------------------------- |
| `plugins`  | the module specifier (this package or your own) |
| `ignorers` | the contribution name (`generated-code` above)  |

A mismatched pair fails silent-green: the run completes with nothing ignored
and only a `Cannot find plugin` warning.

## Test an ignorer

`./testing` publishes the harness on the test-facing subpath, so production
imports never reach it. It takes three statics from whatever runner you use —
no runner is imported here:

```ts
import { IgnoreTester, type IgnoreTesterCases } from '@systemfsoftware/stryker-ignorer-interface/testing'
import { describe, expect, it } from 'vitest'

IgnoreTester.describe = describe
IgnoreTester.it = it
IgnoreTester.expect = expect

const cases: IgnoreTesterCases = {
  ignored: [
    {
      name: 'a member read on the generated namespace',
      path: { node: callee, ancestors: [member, program] },
      reason: 'the enclosing member is generated',
    },
  ],
  kept: [{ name: 'a member read on anything else', path: { node: otherCallee, ancestors: [otherMember] } }],
}

IgnoreTester.run('generated-code', myIgnorer, cases)
```

`run` registers one `describe` holding a descriptor check
(`Should_Register_The_Descriptor`) and one test per case — the ignored ones
assert the reason, the kept ones assert `undefined`, and every case first
asserts its `node` satisfies the ignorer's own `schema`. Calling `run` before
assigning all three statics throws rather than passing silently.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
