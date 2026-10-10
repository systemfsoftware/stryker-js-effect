# @systemfsoftware/stryker-js-typescript-checker

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](../../LICENSE)
[![npm version](https://img.shields.io/npm/v/@systemfsoftware/stryker-js-typescript-checker.svg)](https://www.npmjs.com/package/@systemfsoftware/stryker-js-typescript-checker)

TypeScript checker plugin for Stryker mutation testing — provides native support for TypeScript 5.x through 7.x.

## Why Use a Type Checker Plugin?

Mutation testing modifies code syntax in ways that may cause compiler errors (e.g. invalid type assignments, breaking return type contracts). Without a checker plugin, those mutants execute in your test runner, waste runner execution time, or trigger misleading test runner errors.

The TypeScript checker intercepts mutants _before_ they reach the test runner. If a mutant causes a TypeScript compilation failure, it is classified immediately as `CompileError` without spinning up test runner workers.

## Prerequisites

- Node.js `>=22.18.0`
- TypeScript `>=5.0.0`
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

## In-process runtime (`./runtime`)

The default entry is the worker plugin Stryker loads from `plugins`, and that is all a normal setup needs. Tooling that drives the compiler itself — for example an oracle that instruments a project and hands the mutants to the real checker — can import the in-process runtime from the `./runtime` subpath instead:

```ts
import {
  CheckerRuntime,
  checkerRuntimeLayer,
  nodes,
  TypeScriptCompiler,
} from '@systemfsoftware/stryker-js-typescript-checker/runtime'
```

It publishes the runtime Layer (`checkerRuntimeLayer(options)`), the `CheckerRuntime` service tag with its `CheckerRuntimeShape` type, the `TypeScriptCompiler` service tag and the `nodes` program-graph accessor. Everything else stays behind the worker entry.

## License

[Apache-2.0](../../LICENSE)
