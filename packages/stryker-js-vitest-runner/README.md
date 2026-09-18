# @systemfsoftware/stryker-js-vitest-runner

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](../../LICENSE)
[![npm version](https://img.shields.io/npm/v/@systemfsoftware/stryker-js-vitest-runner.svg)](https://www.npmjs.com/package/@systemfsoftware/stryker-js-vitest-runner)

Vitest test-runner plugin for Stryker mutation testing. Provides fast in-process sandboxing, per-test coverage tracking, and native TypeScript support.

## Prerequisites

- Node.js `>=22.18.0`
- Vitest `>=2.0.0`
- `@systemfsoftware/stryker-js` `>=5.0.0`

## Install

```bash
pnpm add -D @systemfsoftware/stryker-js-vitest-runner vitest
```

## Setup in `stryker.config.ts`

Plugins in Stryker 5.0 are resolved as `file:` URLs via `import.meta.resolve()`:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vitest',
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
  ],
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
  ],
})
```

## How It Works

1. **Dry-run phase**: The Vitest runner executes your existing test suite, collecting per-test execution profiles and code coverage data.
2. **Mutant sandbox**: During the mutation test phase, worker processes run only the subset of tests that cover each mutant, terminating early on test failure to maximize speed.
3. **Vitest Config**: By default, Stryker automatically discovers your `vitest.config.ts` or `vite.config.ts`. If your configuration is located elsewhere, specify it in your config:

```ts
export default defineConfig({
  testRunner: 'vitest',
  plugins: [import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner')],
  vitest: {
    configFile: 'vitest.unit.config.ts',
  },
})
```

## In-Source Tests (`import.meta.vitest`)

If your project uses in-source testing with `if (import.meta.vitest)` blocks, add the companion ignorer plugin so unreachable test mutants are excluded from your score:

```bash
pnpm add -D @systemfsoftware/stryker-ignorer-in-source-vitest-block
```

```ts
export default defineConfig({
  testRunner: 'vitest',
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    import.meta.resolve('@systemfsoftware/stryker-ignorer-in-source-vitest-block'),
  ],
  ignorers: ['in-source-vitest-block'],
})
```

## License

[Apache-2.0](../../LICENSE)
