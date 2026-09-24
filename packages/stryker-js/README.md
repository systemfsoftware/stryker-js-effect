# `@systemfsoftware/stryker-js`

The modern mutation testing framework for JavaScript and TypeScript.
A ground-up, breaking-change fork of `@stryker-mutator/core` built with Effect 4:
provides the `stryker` executable, in-memory V8 and isolated Vitest runners,
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
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
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

### 1. Shell Command Runner (`testRunner: 'command'`)

Execute any test suite without extra plugins:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'command',
  commandRunner: {
    command: 'npm test',
  },
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
```

### 2. In-Memory V8 VM Runner (`testRunner: 'vm'`)

Run pure unit tests directly inside Node's native V8 VM with zero process spawning overhead:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['test/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
```

## Configuration API (`@systemfsoftware/stryker-js/config`)

The `./config` subpath exports lightweight, inert TypeScript configuration helpers:

```ts
import { defineConfig, mergeConfig } from '@systemfsoftware/stryker-js/config'
```

### `defineConfig(options | configFactory)`

Identity function providing strict autocompletion and type checking without runtime dependencies. Can take a configuration object or a factory receiving `ConfigEnv`:

```ts
export default defineConfig(({ isCi, command }) => ({
  testRunner: 'vitest',
  plugins: ['@systemfsoftware/stryker-js-vitest-runner'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  concurrency: isCi ? 2 : 4,
}))
```

### `mergeConfig(base, overrides)`

Deeply merges configuration presets. Keys in records merge recursively; scalar values and arrays in `overrides` completely replace base values:

```ts
import { mergeConfig } from '@systemfsoftware/stryker-js/config'
import baseConfig from './stryker.base.config.ts'

export default mergeConfig(baseConfig, {
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
import { strykerCell } from '@systemfsoftware/stryker-js'

NodeRuntime.runMain(strykerCell({
  mutate: ['src/**/*.ts'],
  testRunner: 'command',
}))
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
| `./config`   | `defineConfig`, `mergeConfig`, and `StrykerConfig` typing          |
| `./promises` | `run()` wrapper returning standard JavaScript promises             |

## License

[Apache-2.0](../../LICENSE)
