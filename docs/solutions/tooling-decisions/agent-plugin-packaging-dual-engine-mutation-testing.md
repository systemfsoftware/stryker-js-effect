---
title: "Agent plugin packaging and dual-engine mutation testing workflow"
date: "2026-09-18"
category: "tooling-decisions"
tags:
  - "agent-plugins"
  - "stryker-js"
  - "mutation-testing"
  - "dual-engine"
  - "vm-runner"
  - "vitest"
---

# Agent Plugin Packaging and Dual-Engine Mutation Testing Workflow

## Problem Frame

When engineers and autonomous coding agents attempt to set up mutation testing in modern TypeScript repositories, two structural failures occur:

1. **Local Latency Penalty**: Running full test harnesses (such as Vitest worker sandboxes) across hundreds of mutant permutations introduces prohibitive latency ($T_{\text{run}} = N_{\text{mutants}} \times T_{\text{worker}}$), turning fast local feedback into a multi-minute pause.
2. **Bare-Name Plugin Resolution**: every plugin field (`plugins`, `appendPlugins`, `ignorers`, `testRunner.plugin`, `checkers[].plugin`) takes the package's bare name, resolved from the project under test; a `file://` URL to a local build stays accepted.

## Architectural Invariants

### 1. Dual-Engine Runtime Invariant (`isCi` Bifurcation)

The mutation runner architecture must differentiate between local development feedback and CI gate enforcement without requiring diverging configuration files:

$$\text{Runner}(E) = \begin{cases} \text{In-Process Worker-Thread `vm`}, & E \neq \text{CI} \\ \text{Isolated Vitest Workers (`vitest`)}, & E = \text{CI} \end{cases}$$

- **Local (`testRunner: 'vm'`)**: Runs Vitest suites in-process in a worker thread per runner, loading each test file as native ESM through Node's module hooks. No child process and no bundler step; the real matchers, mocks, and snapshots come from the `vitest` installed in the project.
- **CI (`testRunner: 'vitest'`)**: Executes within isolated worker processes, capturing comprehensive per-test coverage analysis and supporting complete mock/DOM environments.

```ts
import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define(({ isCi }) => ({
  testRunner: isCi ? 'vitest' : 'vm',
  checkers: ['typescript'],
  plugins: [
    '@systemfsoftware/stryker-js-vitest-runner',
    '@systemfsoftware/stryker-js-typescript-checker',
  ],
  testFiles: ['test/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/__tests__/**', '!src/**/*.d.ts'],
  incremental: !isCi,
}))
```

### 2. Bare-Name Plugin Resolution Law

Installed packages take the bare name, resolved from the project under test. A `file://` URL to a local build stays accepted:

```ts
export default StrykerConfig.define({
  plugins: ['@systemfsoftware/stryker-js-vitest-runner'],
})
```

### 3. Ignorer Registration Parity

AST ignorer plugins require paired declarations:

1. The ignorer plugin package's bare name in `plugins` (or a `file://` URL for a local build).
2. The ignorer's exact string identifier in `ignorers`.

Declaring an ignorer name without the underlying plugin fails silent-green; declaring the plugin without the ignorer name leaves equivalent mutants active.

## Verification & Prevention

- **Dry-Run Gate**: Always verify baseline test execution before mutating code:
  ```bash
  pnpm exec stryker run --dryRunOnly
  ```
- **Agent Skill & Evaluation Suite**: The `stryker-mutation-testing` agent skill packages these invariants into `agent-plugins.org` v1.0.0 format, backed by an 8-eval benchmark proving a +59.3pp discriminator win over unguided models.
