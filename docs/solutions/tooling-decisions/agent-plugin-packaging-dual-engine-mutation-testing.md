---
title: "Agent plugin packaging and dual-engine mutation testing workflow"
date: "2026-09-18"
category: "tooling-decisions"
tags:
  - "agent-plugins"
  - "stryker-js"
  - "mutation-testing"
  - "dual-engine"
  - "v8-vm"
  - "vitest"
---

# Agent Plugin Packaging and Dual-Engine Mutation Testing Workflow

## Problem Frame

When engineers and autonomous coding agents attempt to set up mutation testing in modern TypeScript repositories, two structural failures occur:

1. **Local Latency Penalty**: Running full test harnesses (such as Vitest worker sandboxes) across hundreds of mutant permutations introduces prohibitive latency ($T_{\text{run}} = N_{\text{mutants}} \times T_{\text{worker}}$), turning fast local feedback into a multi-minute pause.
2. **ESM Plugin Resolution Breakage**: Stryker JS Effect v5 enforces standard ECMAScript module boundary isolation. Plugins must be provided as explicit `file:` URLs via `import.meta.resolve()`. Bare module specifiers (e.g. `plugins: ['@stryker-mutator/vitest-runner']`) throw fatal `PluginLoadFailedError` exceptions at startup.

## Architectural Invariants

### 1. Dual-Engine Runtime Invariant (`isCi` Bifurcation)

The mutation runner architecture must differentiate between local development feedback and CI gate enforcement without requiring diverging configuration files:

$$\text{Runner}(E) = \begin{cases} \text{In-Memory V8 VM (`vm`)}, & E \neq \text{CI} \\ \text{Isolated Vitest Workers (`vitest`)}, & E = \text{CI} \end{cases}$$

- **Local (`testRunner: 'vm'`)**: Evaluates pure unit tests directly inside Node's V8 VM context via `stripTypeScriptTypes`. Eliminates process-forking overhead and operates with in-memory execution speed.
- **CI (`testRunner: 'vitest'`)**: Executes within isolated worker processes, capturing comprehensive per-test coverage analysis and supporting complete mock/DOM environments.

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig(({ isCi }) => ({
  testRunner: isCi ? 'vitest' : 'vm',
  checkers: ['typescript'],
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
  ],
  testFiles: ['test/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/__tests__/**', '!src/**/*.d.ts'],
  incremental: !isCi,
}))
```

### 2. URL Plugin Resolution Law

Bare module strings are prohibited in `plugins`. Every plugin specifier must be resolved to a canonical `file:` URL via `import.meta.resolve()` to survive ESM module boundary crossing:

```ts
// Invariant Law: Always resolve to file: URLs
plugins: ;
;[import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner')]
```

### 3. Ignorer Registration Parity

AST ignorer plugins require paired declarations:

1. The plugin module `file:` URL in `plugins`.
2. The ignorer's exact string identifier in `ignorers`.

Declaring an ignorer name without the underlying plugin fails silent-green; declaring the plugin without the ignorer name leaves equivalent mutants active.

## Verification & Prevention

- **Dry-Run Gate**: Always verify baseline test execution before mutating code:
  ```bash
  pnpm exec stryker run --dryRunOnly
  ```
- **Agent Skill & Evaluation Suite**: The `stryker-mutation-testing` agent skill packages these invariants into `agent-plugins.org` v1.0.0 format, backed by an 8-eval benchmark proving a +59.3pp discriminator win over unguided models.
