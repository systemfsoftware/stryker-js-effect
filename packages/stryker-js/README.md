# `@systemfsoftware/stryker-js`

The Stryker mutation testing tool: the `stryker` executable, the run engine it
drives, and the configuration surface a project writes its options against.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-js
```

## Configure

```ts
// stryker.config.ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig(({ isCi }) => ({
  testRunner: 'vitest',
  plugins: ['@systemfsoftware/stryker-js-vitest-runner'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
}))
```

`defineConfig` is an identity function: it preserves literal types and accepts
an object, a promise, or a function receiving `ConfigEnv` (`command`,
`isDryRun`, `mode`, `isCi`). `mergeConfig` composes a preset with overrides —
records merge key by key, and a scalar or array (the default plugin globs among
them) replaces the default outright.

## Run

```bash
pnpm exec stryker run
```

The **`command`** runner ships in the box: it shells out to a configured command
and reads its exit code.

Projects whose suites depend on a real module graph, DOM emulation, or per-test
coverage use the satellite `@systemfsoftware/stryker-js-vitest-runner` instead.

## Program from Effect

```ts
import { NodeRuntime } from '@effect/platform-node'
import { strykerCell } from '@systemfsoftware/stryker-js'

NodeRuntime.runMain(strykerCell({ mutate: ['src/**/*.ts'] }))
```

`strykerCell` is a lazy `Effect`, not a started promise. Callers that speak
promises import the wrapper instead:

```ts
import { run } from '@systemfsoftware/stryker-js/promises'

const report = await run({ testRunner: 'command' })
```

## Subpaths

| Subpath               | What it is                                                        |
| --------------------- | ----------------------------------------------------------------- |
| `.`                   | Programmatic surface: Effect cells, layers and the run vocabulary |
| `./config`            | `defineConfig`, `mergeConfig`, `ConfigEnv`, `StrykerConfig`       |
| `./promises`          | `run` — the same run, interpreted for promise callers             |
| `./builtin-reporters` | The built-in reporter factories                                   |
| `./plugin-loader`     | Plugin discovery and worker-entry resolution                      |

## Related

- [`@systemfsoftware/stryker-js-instrumenter`](../stryker-js-instrumenter) — AST mutation and the mutant vocabulary
- [`@systemfsoftware/stryker-js-plugin-interface`](../stryker-js-plugin-interface) — the plugin boundary: RPC groups, payload schemas, typed failures
- [`@systemfsoftware/stryker-js-vitest-runner`](../stryker-js-vitest-runner) — the Vitest-backed test runner
- [`@systemfsoftware/stryker-js-html-reporter`](../stryker-js-html-reporter) — the HTML report

## License

Apache-2.0
