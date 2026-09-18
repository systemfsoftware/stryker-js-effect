# stryker-js-effect

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Effect: 4.x](https://img.shields.io/badge/Effect-4.0_RC-purple.svg)](https://effect.website)
[![CI](https://github.com/systemfsoftware/stryker-js-effect/actions/workflows/release.yml/badge.svg)](https://github.com/systemfsoftware/stryker-js-effect/actions)

> 🔬 **stryker-js-effect** is an Effect 4 mutation testing framework and breaking-change fork of `@stryker-mutator/core`.
> ⚡ Built from first principles: in-memory V8 execution, standard ESM `file:` URL plugin resolution, real-time NDJSON streams, cancel-safe partial reports, reliable incremental state, and TypeScript 7 native support.
> 🤖 Built for automated CI pipelines, fast local developer loops, and AI coding agents.

```bash
pnpm add -D @systemfsoftware/stryker-js
pnpm exec stryker run
```

---

## 🎯 What is Mutation Testing?

Code coverage only measures which lines were executed during tests; it cannot tell whether assertions actually verify behavior. Mutation testing introduces small synthetic bugs (mutants) into source files to prove that your test suite catches them:

- 💀 **Killed**: A test failed while the mutant was active. The test proved its assertion holds.
- 🧟 **Survived**: All tests passed despite broken code. Exposes an assertion gap or dead code.
- ⏳ **Timeout**: The mutant introduced an infinite loop or deadlock.
- 🚫 **No Coverage**: No test touched the mutated code path during the dry-run phase.

A **100% mutation score** guarantees that every mutation of business logic breaks at least one test assertion.

---

## ⚡ Recommended Workflow: Fast Local V8, Strict CI Vitest

A major pain point in mutation testing is feedback latency: running full test runner harnesses (like Vitest) across hundreds of mutants can take several minutes locally.

Stryker JS Effect provides a dual-engine workflow:

1. **Locally (`testRunner: 'vm'`)**: Evaluates pure unit tests directly in Node's native V8 VM with zero process-forking overhead and native TypeScript stripping. Lightning fast for authoring and debugging test assertions.
2. **In CI (`testRunner: 'vitest'`)**: Runs full integration tests in isolated Vitest worker sandboxes with per-test coverage analysis.

Because `defineConfig` provides `{ isCi }`, you can configure this seamlessly in one `stryker.config.ts`:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig(({ isCi }) => ({
  // Use ultra-fast in-memory V8 locally; full Vitest sandbox in CI
  testRunner: isCi ? 'vitest' : 'vm',
  checkers: ['typescript'],
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
  ],
  // For local V8 runner:
  testFiles: ['test/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
    '!src/**/*.d.ts',
  ],
  incremental: !isCi,
  thresholds: {
    high: 90,
    low: 70,
    break: 80,
  },
}))
```

---

## 🚀 Quick Start by Runner

### Scenario A: Vitest Runner (Standard CI / Full Sandbox)

Best for suites that require full Vitest APIs (`vi.mock`, DOM emulation, browser runners, or cross-file coverage mapping):

```bash
pnpm add -D @systemfsoftware/stryker-js \
  @systemfsoftware/stryker-js-vitest-runner \
  @systemfsoftware/stryker-js-typescript-checker
```

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vitest',
  checkers: ['typescript'],
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
  ],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts'],
})
```

---

### Scenario B: In-Memory V8 VM Runner (Instant Local Feedback)

Best for pure logic, algorithmic cores, and fast local development. Executes tests directly in Node's V8 context with no child processes:

```bash
pnpm add -D @systemfsoftware/stryker-js @systemfsoftware/stryker-js-typescript-checker
```

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['test/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
```

---

### Scenario C: Shell Command Runner (Any Runner / Zero Plugins)

If your project runs tests with Jest, Mocha, or a custom script:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'command',
  commandRunner: {
    command: 'pnpm test',
  },
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
```

## 🛠️ Configuration Recipes

### 1. The Production Monorepo / Strict Quality Gate

For mission-critical libraries requiring 100% mutation kill rates and zero false survivors on type declarations or in-source Vitest blocks:

```bash
pnpm add -D @systemfsoftware/stryker-js \
  @systemfsoftware/stryker-js-vitest-runner \
  @systemfsoftware/stryker-js-typescript-checker \
  @systemfsoftware/stryker-ignorer-effect-schema-declarations \
  @systemfsoftware/stryker-ignorer-in-source-vitest-block
```

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig(({ isCi }) => ({
  testRunner: 'vitest',
  checkers: ['typescript'],
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
    import.meta.resolve('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    import.meta.resolve('@systemfsoftware/stryker-ignorer-in-source-vitest-block'),
  ],
  ignorers: [
    'effect-schema-declarations',
    'in-source-vitest-block',
  ],
  mutate: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/**/*.d.ts',
  ],
  reporters: isCi ? ['progress', 'clear-text'] : ['progress', 'clear-text', 'html'],
  concurrency: isCi ? 2 : 4,
  thresholds: {
    high: 100,
    low: 90,
    break: 100,
  },
}))
```

### 2. Environment-Aware Configuration (`ConfigEnv`)

`defineConfig` accepts a callback that receives `{ command, isDryRun, mode, isCi }`:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig(({ isCi, isDryRun }) => ({
  testRunner: 'vitest',
  plugins: [import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner')],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  // Run faster locally with incremental caching, strict in CI
  incremental: !isCi,
}))
```

---

## ⚠️ Breaking Architectural Changes vs Upstream StrykerJS

`stryker-js-effect` is an intentional breaking fork, not a drop-in shim. Upstream patterns that do not work:

1. **Plugins Are Resolved via `import.meta.resolve()`**: Bare string package names (`plugins: ['@stryker-mutator/...']`) are rejected. Plugins must be explicit `file:` URLs (`plugins: [import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner')]`).
2. **Single Flagship Package (`@systemfsoftware/stryker-js`)**: The separate CLI and engine packages are unified. Configuration helpers (`defineConfig`, `mergeConfig`) ship from `@systemfsoftware/stryker-js/config`.
3. **In-Memory V8 Runner**: The built-in `testRunner: 'vm'` runs tests directly in Node's V8 context with native TS type stripping, eliminating worker-spawning overhead.
4. **Deterministic Exit Codes & Real-Time NDJSON**: Streams newline-delimited JSON events to `stdout` with distinct exit codes (`0` ok, `1` threshold failed, `2` config error, `3` runtime error, `4` internal error).

---

## 📖 Key Configuration Options Reference

| Option                 | Type                            | Default                              | Description                                                                                          |
| ---------------------- | ------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `mutate`               | `string[]`                      | `['src/**/*.js', 'src/**/*.ts']`     | Files to mutate. Prefix with `!` to exclude test files, fixtures, and declaration files.             |
| `testRunner`           | `'vitest' \| 'command' \| 'vm'` | `'vitest'`                           | Execution strategy for running tests against mutants.                                                |
| `plugins`              | `string[]`                      | `[]`                                 | Explicit `file:` URLs to plugins, resolved with `import.meta.resolve('@systemfsoftware/...')`.       |
| `checkers`             | `string[]`                      | `[]`                                 | Type checker plugins (e.g. `['typescript']`) that discard uncompilable mutants before running tests. |
| `ignorers`             | `string[]`                      | `[]`                                 | Registered AST ignorer rules that skip equivalent or unobservable mutants.                           |
| `concurrency`          | `number`                        | `CPU cores - 1`                      | Maximum parallel worker processes for checkers and test runners.                                     |
| `reporters`            | `string[]`                      | `['progress', 'clear-text', 'html']` | Output reporters. `html` writes an interactive report to `reports/mutation/`.                        |
| `thresholds`           | `{ high, low, break }`          | `{ high: 80, low: 60, break: 0 }`    | Score thresholds. If final score is below `break`, the CLI exits with non-zero exit code `1`.        |
| `incremental`          | `boolean`                       | `false`                              | Cache results across runs in `reports/stryker-incremental.json` to skip re-testing unchanged code.   |
| `survivorsPriorReport` | `string`                        | `undefined`                          | Path to prior report when running `--survivors` targeted re-testing.                                 |

---

## ⚡ Key Differentiators vs Upstream StrykerJS

| Capability               | Upstream StrykerJS                                | stryker-js-effect                                                                            |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Output Protocol**      | TUI progress bar, terminal scrapers               | Machine-readable real-time NDJSON stream on `stdout`                                         |
| **Interrupted Runs**     | `Ctrl+C` / cancel yields 0 reports                | Emits cancel-safe partial report up to last completed mutant                                 |
| **Incremental State**    | `stryker-incremental.json` frequently invalidates | Strict schema validation surviving aborted and interrupted runs                              |
| **Agent / CI Mode**      | Generic CLI exit codes (`0` or `1`)               | Machine mode auto-detection (`AGENT`, `CLAUDECODE`, `CODEX_SANDBOX`) + classified exit codes |
| **TypeScript 7**         | Slower AST parsing                                | Fast AST mutation powered by OXC parser with TS 7 native support                             |
| **Plugin Resolution**    | Fragile `node_modules` walking                    | Standard ESM `file:` URL resolution via `import.meta.resolve()`                              |
| **Runtime Architecture** | Imperative JavaScript                             | Pure functional Effect 4 architecture with typed domain errors                               |

---

## 🚦 Classified Exit Codes

Stryker provides deterministic exit codes so CI pipelines and autonomous agents can react accurately:

| Exit Code | Classification | Meaning                                                                    |
| --------- | -------------- | -------------------------------------------------------------------------- |
| `0`       | Success        | Mutation score met or exceeded configured `thresholds.break`.              |
| `1`       | Verdict Failed | Mutation score fell below required `thresholds.break`.                     |
| `2`       | Config Error   | Invalid configuration file, unsupported options schema, or missing plugin. |
| `3`       | Runtime Error  | Test runner crashed or instrumenter encountered invalid syntax.            |
| `4`       | Internal Error | Unhandled engine defect or unexpected platform fault.                      |
| `128 + n` | Process Signal | Terminated by POSIX signal `n` (e.g. `130` for `SIGINT` / `Ctrl+C`).       |

## 📚 Advanced Guides

Detailed authoring guides are packaged in the agent skill:

- [Authoring Custom Ignorers](skills/stryker-mutation-testing/references/authoring-ignorers.md) — Write custom AST visitors with `@systemfsoftware/stryker-ignorer-kit` to filter false surviving mutants.
- [Authoring Custom Test Runners](skills/stryker-mutation-testing/references/authoring-runners.md) — Build custom test runner worker plugins via `@systemfsoftware/stryker-js-plugin-interface` and Effect RPC.

## 📦 Workspace Packages

| Package                                                                                                       | Purpose                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`@systemfsoftware/stryker-js`](packages/stryker-js)                                                          | Flagship CLI binary, run engine, and `./config` authoring surface (`defineConfig`, `mergeConfig`) |
| [`@systemfsoftware/stryker-js-vitest-runner`](packages/stryker-js-vitest-runner)                              | High-performance Vitest test runner plugin with sandbox isolation                                 |
| [`@systemfsoftware/stryker-js-typescript-checker`](packages/stryker-js-typescript-checker)                    | Pre-execution TypeScript type checker plugin rejecting invalid mutants                            |
| [`@systemfsoftware/stryker-js-html-reporter`](packages/stryker-js-html-reporter)                              | Interactive HTML mutation report generator (`reports/mutation/index.html`)                        |
| [`@systemfsoftware/stryker-ignorer-kit`](packages/ignorers/kit)                                               | Authoring kit (`defineIgnorer`) and test harness (`testIgnorer`) for custom ignorers              |
| [`@systemfsoftware/stryker-ignorer-interface`](packages/ignorers/interface)                                   | AST node types and `Ignorer` contract                                                             |
| [`@systemfsoftware/stryker-ignorer-effect-schema-declarations`](packages/ignorers/effect-schema-declarations) | Ignorer filtering equivalent mutants on Effect Schema and Brand declarations                      |
| [`@systemfsoftware/stryker-ignorer-in-source-vitest-block`](packages/ignorers/in-source-vitest-block)         | Ignorer removing unreachable mutants inside `if (import.meta.vitest)` blocks                      |
| [`@systemfsoftware/stryker-test-contribution`](packages/stryker-test-contribution)                            | Test suite hygiene plugin enforcing unique mutant kills per test file                             |

If the mutation score falls below `thresholds.break`, Stryker exits with code `1`, failing the CI check.

### Real-Time NDJSON Streaming

When running in CI or under an AI agent harness (`STRYKER_MODE=machine`), Stryker emits newline-delimited JSON events to `stdout`:

```console
$ STRYKER_MODE=machine pnpm exec stryker run
{"kind":"stream","schemaVersion":"1.0","runId":"06FY3DSBM7TYC2RZQ0F3EGVZ88","mode":"machine","signal":"tty"}
{"kind":"phase","phase":"instrument","elapsedMs":102}
{"kind":"phase","phase":"dry-run","elapsedMs":6658}
{"kind":"plan","total":42}
{"kind":"tick","elapsedMs":8200,"completed":1,"total":42}
{"kind":"verdict","schemaVersion":"1.0","score":100,"thresholds":{"high":100,"low":80,"break":80},"counts":{"killed":42,"survived":0,"timeout":0,"noCoverage":0},"reportFile":"reports/mutation/mutation.json"}
```

---

## 🤝 Contributing

Development setup, verification gates, and pull request guidelines are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).
