# `@systemfsoftware/stryker-js`

The modern mutation testing framework for JavaScript and TypeScript.
A ground-up, breaking-change fork of `@stryker-mutator/core` built with Effect 4:
provides the `stryker` executable, the `vm` and `vitest` test runners, and the
typed `./config` authoring surface.

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

The `vm` runner is the default and needs no plugin packages: `testRunner: 'vm'`
runs Vitest itself, on Vitest's isolated `threads` pool, through the project's
own `vitest` install (`vitest` must be installed). With no `testFiles`
configured, Vitest selects the test files from your config, exactly as
`vitest run` does. The runner reports the same test ids, outcomes and
per-mutant verdicts as `vitest run`. Set `testFiles` explicitly, or pick one of
the runners below, to take control.

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

### 2. The `vm` Runner (`testRunner: 'vm'`)

Runs the Vitest runner on Vitest's isolated `threads` pool. Each test file keeps
Vitest's own per-file isolation, and module mocking, snapshots, environments,
setup files, projects and custom transforms behave as they do under
`vitest run`. A Vitest config that enables browser mode is refused with an
error naming `testRunner: 'vitest'`; pick the `vitest` runner for those.

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['test/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
```

Suites that need Vitest's `forks` pool (for example `process.chdir`, or native
addons that are not thread-safe) use `testRunner: 'vitest'` with the
`@systemfsoftware/stryker-js-vitest-runner` plugin instead.

## Configuration API (`@systemfsoftware/stryker-js/config`)

The `./config` subpath exports the typed configuration authoring surface, including the `StrykerConfig` type naming the partial options a config file writes: a config annotated `const config: StrykerConfig = defineConfig({ ... })` typechecks and loads.

```ts
import { defineConfig, type StrykerConfig } from '@systemfsoftware/stryker-js/config'
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
pnpm exec stryker merge-reports --parts reports/shards --out reports/mutation
```

## Output Modes

Human output is the default, whether or not `stdout` is a terminal. A machine consumer opts into the NDJSON event stream explicitly:

```bash
pnpm exec stryker run --json                # wire records on stdout, diagnostics on stderr
STRYKER_MODE=machine pnpm exec stryker run  # the same, named by environment
```

`--format text` names the human format explicitly; `--json` together with `--format text` is a usage error (exit 2). Under `--json`, `stdout` carries wire records and nothing else — progress lines and log output stay on `stderr`. Every run also writes the same records to `reports/mutation-stream.jsonl` (`--progressStreamFile`) in both modes, which is the artifact `stryker merge-reports` rebuilds a shard's partial report from.

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

| Subpath      | Description                                                               |
| ------------ | ------------------------------------------------------------------------- |
| `.`          | Main entry point: `strykerCell`, runtime layers, and error schemas        |
| `./config`   | Config authoring surface (`defineConfig`, `mergeConfig`, `StrykerConfig`) |
| `./promises` | `run()` wrapper returning standard JavaScript promises                    |

## License

[Apache-2.0](../../LICENSE)
