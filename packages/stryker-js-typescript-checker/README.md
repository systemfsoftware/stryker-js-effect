# @systemfsoftware/stryker-js-typescript-checker

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](../../LICENSE)
[![npm version](https://img.shields.io/npm/v/@systemfsoftware/stryker-js-typescript-checker.svg)](https://www.npmjs.com/package/@systemfsoftware/stryker-js-typescript-checker)

TypeScript checker plugin for Stryker mutation testing, built on the native TypeScript 7 compiler.

## Why Use a Type Checker Plugin?

Mutation testing modifies code syntax in ways that may cause compiler errors (e.g. invalid type assignments, breaking return type contracts). Without a checker plugin, those mutants execute in your test runner, waste runner execution time, or trigger misleading test runner errors.

The TypeScript checker intercepts mutants _before_ they reach the test runner. If a mutant causes a TypeScript compilation failure, it is classified immediately as `CompileError` without spinning up test runner workers.

## Prerequisites

- Node.js `>=22.18.0`
- TypeScript `>=7.0.0`
- `@systemfsoftware/stryker-js` `>=5.0.0`

## Install

```bash
pnpm add -D @systemfsoftware/stryker-js-typescript-checker typescript
```

## Setup in `stryker.config.ts`

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  checkers: ['typescript'],
  plugins: ['@systemfsoftware/stryker-js-typescript-checker'],
  // Optional custom tsconfig path (defaults to tsconfig.json)
  // tsConfigFile: 'tsconfig.build.json',
})
```

## Options

Options go in a `typescriptChecker` block of the Stryker config.

### `importerCheck`

`'location-rule'` (default) or `'always'`.

When a mutant compiles in its own file, the checker normally re-checks every file that imports that file, and every file of the program when the mutated file is a script or declares `declare global`. Under `'location-rule'` it skips that re-check when the edit cannot change any type another file sees:

- the edit sits inside the body of one function, method, constructor, accessor or arrow function;
- that function has an explicit return type annotation, or is a constructor or a `set` accessor;
- the file is a TypeScript module with no `declare global`;
- the edit holds no `import()`, `require()` or `import("…")` type.

All four must hold before and after the edit, and the function's header (everything before its body) must be unchanged. Mutants that meet the rule and sit in different files are checked together in one snapshot update. Under `isolatedDeclarations`, every exported function has an annotation, so the rule applies to most of its body edits.

`'always'` re-checks importers for every mutant that compiles in its own file and checks one mutant per snapshot update. Use it if you suspect a verdict is wrong. Changing the option changes the program digest, so incremental runs never mix verdicts from the two modes.

```ts
export default defineConfig({
  checkers: ['typescript'],
  plugins: ['@systemfsoftware/stryker-js-typescript-checker'],
  typescriptChecker: { importerCheck: 'always' },
})
```

## In-process runtime (`./runtime`)

The default entry is the worker plugin Stryker loads from `plugins`, and that is all a normal setup needs. Tooling that drives the compiler itself — for example an oracle that instruments a project and hands the mutants to the real checker — can import the in-process runtime from the `./runtime` subpath instead:

```ts
import { CheckerRuntime, nodes, TypeScriptCompiler } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
```

It publishes the runtime Layer (`CheckerRuntime.layer(options)`), its `CheckerRuntimeShape` type, the `TypeScriptCompiler` service tag and the `nodes` program-graph accessor. Everything else stays behind the worker entry.

## Type query (`./type-query`)

Provisional: this entry changes shape when its consumer confirms it, and that change ships as an ordinary break.

`./type-query` exports `TypeQueryLive`, a `Layer` that implements the `TypeQuery` port from `@systemfsoftware/stryker-js-plugin-interface/type-query`. It answers type queries on its own tsgo server, opened on first use per `tsconfigFile` and closed when the layer's scope closes.

```ts
import { TypeQuery } from '@systemfsoftware/stryker-js-plugin-interface/type-query'
import { TypeQueryLive } from '@systemfsoftware/stryker-js-typescript-checker/type-query'
import * as Effect from 'effect/Effect'

const answered = Effect.scoped(
  Effect.provide(
    Effect.gen(function*() {
      const query = yield* TypeQuery
      return yield* query.query(request)
    }),
    TypeQueryLive,
  ),
)
```

## License

[Apache-2.0](../../LICENSE)
