# `@systemfsoftware/stryker-js`

The modern mutation testing framework for JavaScript and TypeScript.
A ground-up, breaking-change fork of `@stryker-mutator/core` built with Effect 4:
provides the `stryker` executable, in-process `vm` and isolated Vitest runners,
and the typed `./config` authoring surface.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-js
```

## Quick Start: Vitest Runner

For TypeScript codebases using Vitest:

```bash
pnpm add -D @systemfsoftware/stryker-js \
  @systemfsoftware/stryker-js-vitest-runner \
  @systemfsoftware/stryker-js-typescript-checker
```

Create `stryker.config.ts` in your project root:

```ts
import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: 'vitest',
  checkers: ['typescript'],
  plugins: [
    '@systemfsoftware/stryker-js-vitest-runner',
    '@systemfsoftware/stryker-js-typescript-checker',
  ],
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
  ],
  thresholds: {
    high: 90,
    low: 70,
    break: 80,
  },
})
```

Run mutation testing:

```bash
pnpm exec stryker run
```

## Zero-Plugin Built-in Runners

The `vm` runner is the default: with no `testRunner` and no `testFiles`
configured, it discovers `*.test` / `*.spec` files itself and runs them. It loads
your suites through your project's `vitest`, so `vitest` must be installed.
Set `testFiles` explicitly, or pick one of the runners below, to take control.

### 1. Shell Command Runner (`testRunner: 'command'`)

Execute any test suite without extra plugins:

```ts
import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: 'command',
  commandRunner: {
    command: 'npm test',
  },
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
```

### 2. In-Process `vm` Runner (`testRunner: 'vm'`)

Runs Vitest suites in-process, in one worker thread per test runner, loading each test file as native ESM through Node's module hooks. No child process and no bundler step. Each file gets its own module state by default; your `vitest.config.*` (environment, setup files, globals, projects) is picked up through your project's `vitest` install. Vitest browser-mode suites are refused with an error naming `testRunner: 'vitest'`; pick the `vitest` runner for those.

```ts
import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: 'vm',
  testFiles: ['test/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
```

## Configuration API (`@systemfsoftware/stryker-js/config`)

The `./config` subpath exports the typed configuration authoring surface:

```ts
import { StrykerConfig } from '@systemfsoftware/stryker-js/config'
```

### `StrykerConfig.define(options | configFactory)`

Identity function providing strict autocompletion and type checking without runtime dependencies. Can take a configuration object or a factory receiving `ConfigEnv`:

```ts
export default StrykerConfig.define(({ isCi, command }) => ({
  testRunner: 'vitest',
  plugins: ['@systemfsoftware/stryker-js-vitest-runner'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  concurrency: isCi ? 2 : 4,
}))
```

### `StrykerConfig.merge(base, overrides)`

Deeply merges configuration presets. Keys in records merge recursively; scalar values and arrays in `overrides` completely replace base values:

```ts
import { StrykerConfig } from '@systemfsoftware/stryker-js/config'
import baseConfig from './stryker.base.config.ts'

export default StrykerConfig.merge(baseConfig, {
  concurrency: 8,
  mutate: ['packages/core/src/**/*.ts'],
})
```

## CLI Usage and Flags

```bash
# Run mutation testing
pnpm exec stryker run [options]

# Mutate specific files only
pnpm exec stryker run --mutate "src/auth/*.ts"

# Re-test only surviving mutants from prior run
pnpm exec stryker run --survivors

# Enable incremental caching
pnpm exec stryker run --incremental

# Run with specific concurrency
pnpm exec stryker run --concurrency 4

# Merge partial mutation reports from parallel CI shards
pnpm exec stryker merge-reports --output reports/mutation/mutation.json "reports/shards/*.json"
```

## Programmatic API

### Effect 4 Native Interface

```ts
import { NodeRuntime } from '@effect/platform-node'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'

NodeRuntime.runMain(
  Engine.strykerCell({
    mutate: ['src/**/*.ts'],
    testRunner: 'command',
  }).pipe(Effect.provide(Engine.nodePlatformLayer)),
)
```

### Vanilla Promise Interface (`./promises`)

For non-Effect environments:

```ts
import { run } from '@systemfsoftware/stryker-js/promises'

const verdict = await run({
  testRunner: 'command',
  commandRunner: { command: 'pnpm test' },
})

console.log(`Mutation score: ${verdict.score}%`)
```

## Published Subpaths

| Subpath      | Description                                                        |
| ------------ | ------------------------------------------------------------------ |
| `.`          | Main entry point: `strykerCell`, runtime layers, and error schemas |
| `./config`   | `StrykerConfig` authoring surface (`define`, `merge`)              |
| `./promises` | `run()` wrapper returning standard JavaScript promises             |

## License

[Apache-2.0](../../LICENSE)
