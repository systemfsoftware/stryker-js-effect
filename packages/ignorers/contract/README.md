# @systemfsoftware/stryker-ignorer

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-ignorer)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-ignorer)

> The plain ignorer contract: write a mutation-tooling ignore plugin as a name and a function, with zero runtime dependencies.

An ignorer is the smallest thing a StrykerJS-style mutation tool can load: a
name and a synchronous decision — look at an AST path, answer with the reason
a mutant is safe to skip, or say nothing. This package carries the whole
author-facing surface:

| Export             | What it is                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `PlainIgnorer`     | The descriptor type: `{ name, shouldIgnore(path): string \| undefined }`                                                       |
| `NodePath`         | The minimal AST path shape the host hands `shouldIgnore`                                                                       |
| `ancestorsOf`      | The ancestor walk over `NodePath`, nearest first                                                                               |
| `StandardSchemaV1` | The vendored [Standard Schema](https://standardschema.dev) interface — type any validator you publish in library-neutral terms |

## Install

```bash
pnpm add -D @systemfsoftware/stryker-ignorer
```

## Write an ignorer

```ts
import { ancestorsOf, type PlainIgnorer } from '@systemfsoftware/stryker-ignorer'

const myIgnorer: PlainIgnorer = {
  name: 'my-ignore-rule',
  shouldIgnore(path) {
    for (const ancestor of ancestorsOf(path)) {
      if (isGeneratedCode(ancestor)) return 'inside generated code'
    }
    return undefined
  },
}

export const strykerIgnorers = [myIgnorer]
```

A module exporting `strykerIgnorers` loads as `Ignore` plugin contributions
in any engine carrying the plain-ignorer adapter (check your engine's minimum
version). Configure the pair — they take different strings:

| Config key | Value                                           |
| ---------- | ----------------------------------------------- |
| `plugins`  | the module specifier (this package or your own) |
| `ignorers` | the contribution name (`my-ignore-rule` above)  |

A mismatched pair fails silent-green: the run completes with nothing ignored
and only a `Cannot find plugin` warning. Validators typed
`StandardSchemaV1` accept any schema library — Effect Schema, Zod, and
Valibot instances all satisfy the interface.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
