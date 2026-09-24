---
title: Mutation Testing Decision Guide
description: How to choose test runners, checkers, and ignorers in Stryker JS Effect.
content_hash: 0bf2a6
---

# Mutation Testing Decision Guide

## 1. Dual-Engine Architecture: Local In-Process `vm` vs CI `vitest`

| Environment           | Runner                                      | Rationale & Tradeoffs                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local Development** | In-process `vm` runner (`testRunner: 'vm'`) | Runs Vitest suites in-process in a worker thread per runner, loading each test file as native ESM through Node's module hooks. No child process and no bundler step; your `vitest` install supplies the matchers, mocks, and snapshots. Use `testRunner: 'vitest'` for browser-mode suites, which the `vm` runner refuses. |
| **CI Pipeline**       | Vitest runner (`testRunner: 'vitest'`)      | Full isolation with sandboxed worker processes. Provides accurate per-test coverage analysis and supports complex Vitest features (`vi.mock`, timers, DOM).                                                                                                                                                                |

### Dynamic Switch via `isCi`

```ts
import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define(({ isCi }) => ({
  testRunner: isCi ? 'vitest' : 'vm',
  plugins: [
    '@systemfsoftware/stryker-js-vitest-runner',
    '@systemfsoftware/stryker-js-typescript-checker',
  ],
  testFiles: ['test/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  incremental: !isCi,
}))
```

## 2. When to Use the Command Runner

Use `testRunner: 'command'` when the project does not use Vitest (e.g. Jest, Mocha, custom test scripts). It executes the shell command in a child process and reads exit codes.

## 3. Choosing Checkers

| Project Type                                  | Recommended Checker                              | Benefit                                                      |
| --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| TypeScript projects (`tsconfig.json` present) | `@systemfsoftware/stryker-js-typescript-checker` | Discards syntactically broken mutants before executing tests |
| Pure JavaScript                               | None                                             | No type compilation step needed                              |

## 4. Choosing Ignorers

| Stack                                                                   | Ignorer Package                                               | Ignorer Name                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------- |
| Projects using Effect Schema / `@effect/schema`                         | `@systemfsoftware/stryker-ignorer-effect-schema-declarations` | `effect-schema-declarations` |
| Projects using Vitest in-source test blocks (`if (import.meta.vitest)`) | `@systemfsoftware/stryker-ignorer-in-source-vitest-block`     | `in-source-vitest-block`     |
