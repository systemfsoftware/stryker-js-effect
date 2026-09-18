# @systemfsoftware/stryker-ignorer-in-source-vitest-block

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](../../../LICENSE)
[![npm version](https://img.shields.io/npm/v/@systemfsoftware/stryker-ignorer-in-source-vitest-block.svg)](https://www.npmjs.com/package/@systemfsoftware/stryker-ignorer-in-source-vitest-block)

> In-source tests are not production behavior. Stop their mutants from dragging your Stryker score below 100%.

Your `if (import.meta.vitest)` blocks are stripped before production, so code executing during mutation testing never reaches them. They sit in reports as false unkillable survivors.

This Stryker ignorer recognizes and skips mutants inside `import.meta.vitest` test guards, ensuring 100% mutation testing accuracy.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-ignorer-in-source-vitest-block
```

## Setup in `stryker.config.ts`

In `stryker.config.ts`, the plugin URL and the ignorer name travel as a pair:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vitest',
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    import.meta.resolve('@systemfsoftware/stryker-ignorer-in-source-vitest-block'),
  ],
  ignorers: ['in-source-vitest-block'],
})
```

Mutants inside guarded test blocks are reported as `Ignored`.

## What It Ignores

| Guard Shape                        | Example                                               |
| ---------------------------------- | ----------------------------------------------------- |
| Direct Vitest meta property check  | `if (import.meta.vitest) { ... }`                     |
| Comparison check                   | `if (import.meta.vitest !== undefined) { ... }`       |
| Enclosed declarations and fixtures | All test suites and utilities nested within the block |

## License

[Apache-2.0](../../../LICENSE)
