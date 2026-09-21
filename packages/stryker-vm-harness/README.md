# @systemfsoftware/stryker-vm-harness

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](../../LICENSE)
[![npm version](https://img.shields.io/npm/v/@systemfsoftware/stryker-vm-harness.svg)](https://www.npmjs.com/package/@systemfsoftware/stryker-vm-harness)

In-memory VM test-runner harness for Stryker mutation testing. Pure `Cell` / `Sandwich` / `Workflow` core with a thin imperative shell.

## Prerequisites

- Node.js `>=22.18.0`
- Vitest `>=4.1.0`
- `@systemfsoftware/stryker-js` `>=5.0.0`

## Install

```bash
pnpm add -D @systemfsoftware/stryker-vm-harness vitest
```

Consumed by `@systemfsoftware/stryker-js` as the in-process VM runner harness. Public API lands in later units of this extraction.

## License

[Apache-2.0](../../LICENSE)
