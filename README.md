# stryker-js-effect

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Effect: 4.x](https://img.shields.io/badge/Effect-4.0_RC-purple.svg)](https://effect.website)
[![CI](https://github.com/systemfsoftware/stryker-js-effect/actions/workflows/release.yml/badge.svg)](https://github.com/systemfsoftware/stryker-js-effect/actions)

> 🔬 **stryker-js-effect** is an Effect 4 mutation testing framework for TypeScript and JavaScript that replaces slow process-forking runners with in-memory V8 execution, standard ESM plugin resolution, and real-time NDJSON event streams.

Stryker introduces synthetic bugs (mutants) into source code to verify whether test suites catch behavioral regressions or merely pad line coverage metrics.

```bash
pnpm add -D @systemfsoftware/stryker-js
pnpm exec stryker run
```

---

## 🎯 What is Mutation Testing?

Code coverage measures which lines execute during tests, but cannot prove test assertions detect broken logic. Mutation testing validates test suite efficacy by injecting targeted faults:

- 💀 **Killed**: A test fails when a mutant activates. The test suite successfully verified behavior.
- 🧟 **Survived**: Tests pass despite corrupted logic. An untested boundary or dead code path exists.
- ⏳ **Timeout**: The mutant caused an infinite loop or resource deadlock.
- 🚫 **No Coverage**: No test touched the mutated statement during the initial dry-run baseline.

A high mutation score guarantees test assertions catch regressions rather than just walking code paths.

---

## ⚡ Dual-Engine Workflow: In-Memory V8 vs Vitest Worker Sandbox

Mutation testing feedback latency slows down local development when every mutant forks new child processes. Stryker JS Effect provides a dual execution architecture configured through `defineConfig`:

1. **Local Developer Loop (`testRunner: 'vm'`)**: Runs pure unit tests inside Node's native V8 VM with zero process-forking overhead and native TypeScript type stripping.
2. **CI Regression Gate (`testRunner: 'vitest'`)**: Executes integration suites in isolated Vitest worker threads with per-test coverage analysis.

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig(({ isCi }) => ({
  // In-memory V8 locally for instant feedback; isolated Vitest workers in CI
  testRunner: isCi ? 'vitest' : 'vm',
  checkers: ['typescript'],
  plugins: [
    '@systemfsoftware/stryker-js-vitest-runner',
    '@systemfsoftware/stryker-js-typescript-checker',
  ],
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

## 🚀 Installation & Setup

Install the core CLI engine alongside the runner and checker plugins required for your environment:

```bash
pnpm add -D @systemfsoftware/stryker-js \
  @systemfsoftware/stryker-js-vitest-runner \
  @systemfsoftware/stryker-js-typescript-checker
```

### Scenario A: Vitest Runner (Standard CI / Sandbox Isolation)

Recommended for integration suites requiring full Vitest mocking APIs, DOM emulation, or browser runners:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vitest',
  checkers: ['typescript'],
  plugins: [
    '@systemfsoftware/stryker-js-vitest-runner',
    '@systemfsoftware/stryker-js-typescript-checker',
  ],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts'],
})
```

### Scenario B: In-Memory V8 VM Runner (Instant Local Feedback)

Recommended for algorithmic domains and pure business logic. Tests execute directly in Node's V8 context without child process management:

```bash
pnpm add -D @systemfsoftware/stryker-js @systemfsoftware/stryker-js-typescript-checker
```

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  checkers: ['typescript'],
  plugins: [
    '@systemfsoftware/stryker-js-typescript-checker',
  ],
  testFiles: ['test/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
```

### Scenario C: Shell Command Runner (Zero Plugin Fallback)

Execute any test framework (Jest, Mocha, Node test runner) via custom shell commands:

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

---

## 🧩 Framework Plugins: Angular, Vue, and Svelte Files

`.html`, `.htm`, `.vue`, and `.svelte` files are not instrumented by the core —
a framework plugin package claims them. Install the package for your framework
and add its package name to `plugins`:

```bash
pnpm add -D @systemfsoftware/stryker-js-angular # .html, .htm, .vue
# or
pnpm add -D @systemfsoftware/stryker-js-svelte # .svelte (Svelte 5 only)
```

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vitest',
  plugins: ['@systemfsoftware/stryker-js-angular'],
  mutate: ['src/**/*.html', 'src/**/*.vue'],
})
```

The Angular plugin instruments the embedded `<script>` regions of a file and leaves
template expressions untouched; the Svelte plugin also mutates template expressions. A file whose extension no loaded
plugin claims is skipped and the run continues; the skip reason names the plugin
package to add, even when that package is already installed. Every framework
plugin package declares the extensions it claims in its `package.json`
(`"strykerFramework": { "extensions": [...] }`), and the host reads that field
from the project's installed dependencies to name the package without importing
it. A plugin whose peer cannot serve the run refuses instead of loading —
`PeerMissing` (peer not installed), `PeerVersionUnsupported` (outside the
supported range), or `PeerUnrecognized` (it resolved but does not export what
the plugin needs) — and every refusal is a configuration error (exit code `2`).
For Angular, pair the plugin with `@systemfsoftware/stryker-ignorer-angular` so
signal-configuration mutants are ignored. The Svelte plugin is Svelte 5 only
(`svelte` peer `^5.0.0`).

## 🛠️ Configuration Recipes

### Monorepo Quality Gate with Effect Schema AST Ignorers

Filter false survivors in declarative schemas and in-source Vitest blocks to enforce strict 100% mutation thresholds:

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
    '@systemfsoftware/stryker-js-vitest-runner',
    '@systemfsoftware/stryker-js-typescript-checker',
    '@systemfsoftware/stryker-ignorer-effect-schema-declarations',
    '@systemfsoftware/stryker-ignorer-in-source-vitest-block',
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

### Environment-Aware Configuration

`defineConfig` accepts a callback instead of a static object. It receives a `ConfigEnv` of `{ command, isDryRun, mode, isCi }`, where `command` is `'run'` or `'merge-reports'` and `mode` is the resolved output mode:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig(({ command, isCi, isDryRun }) => ({
  testRunner: 'vitest',
  plugins: ['@systemfsoftware/stryker-js-vitest-runner'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  // Keep the incremental cache locally; CI starts from a clean state every time
  incremental: !isCi && command === 'run' && !isDryRun,
}))
```

---

## ⚡ Key Differentiators vs Upstream StrykerJS

stryker-js-effect is an architectural fork built on Effect 4 primitives rather than a backwards-compatible wrapper:

| Capability               | Upstream StrykerJS (`@stryker-mutator/core`) | stryker-js-effect (`@systemfsoftware/stryker-js`)                       |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------------------------- |
| **Plugin Resolution**    | Dynamic string paths in `node_modules`       | Standard ESM resolution from the project: package names or `file:` URLs |
| **Output Protocol**      | Terminal string formatting & TUI progress    | Machine-readable real-time NDJSON event stream on `stdout`              |
| **Aborted Runs**         | Signal cancellation loses partial data       | Emits partial reports containing every settled mutant up to interrupt   |
| **Incremental State**    | Invalidation prone on unexpected exits       | Schema-validated cache files surviving process termination              |
| **Parser Engine**        | Legacy Babel parser pipeline                 | OXC parser AST mutation with TypeScript 7 native syntax                 |
| **Execution Model**      | Persistent worker process pools              | Native in-memory V8 VM execution option with zero IPC                   |
| **Runtime Architecture** | Imperative event callbacks                   | Pure functional Effect 4 runtime with typed defect channels             |

---

## 📖 Configuration Reference

| Option                 | Type                            | Default                                                                                                      | Description                                                                                                 |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `mutate`               | `string[]`                      | `['{src,lib}/**/!(*.+(s\|S)pec\|*.+(t\|T)est).+(cjs\|mjs\|js\|ts\|mts\|cts\|jsx\|tsx)', '!**/__tests__/**']` | Target source files for mutation testing. Prefix with `!` to exclude test suites or declaration files.      |
| `testRunner`           | `'command' \| 'vitest' \| 'vm'` | `'command'`                                                                                                  | Test execution engine. Use `'vm'` for instant local feedback and `'vitest'` for full test runner isolation. |
| `plugins`              | `string[]`                      | `[]`                                                                                                         | Plugin packages to load: bare package names resolved from the project, or explicit `file:` URLs.            |
| `checkers`             | `string[]`                      | `[]`                                                                                                         | Pre-test type checking plugins (`['typescript']`) that discard uncompilable mutants before running tests.   |
| `ignorers`             | `string[]`                      | `[]`                                                                                                         | Registered AST ignorer rules that skip equivalent or unobservable mutants.                                  |
| `concurrency`          | `number`                        | `CPU cores - 1`                                                                                              | Maximum parallel worker threads or child processes.                                                         |
| `reporters`            | `string[]`                      | `['progress', 'clear-text', 'html']`                                                                         | Output formatters. The `html` reporter writes an interactive web report to `reports/mutation/`.             |
| `thresholds`           | `{ high, low, break }`          | `{ high: 80, low: 60, break: null }`                                                                         | Minimum mutation score gates. Exits with non-zero exit code `1` if the final score falls below `break`.     |
| `incremental`          | `boolean`                       | `false`                                                                                                      | Caches test results in `reports/stryker-incremental.json` to skip re-evaluating unchanged files.            |
| `survivorsPriorReport` | `string`                        | `'reports/mutation-report.json'`                                                                             | Path to prior report when running targeted survivor re-runs.                                                |

---

## 🚦 Classified CLI Exit Codes

Stryker returns distinct exit codes to allow CI pipelines and AI coding agents to branch deterministically:

| Exit Code | Classification         | Meaning                                                                                 |
| --------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `0`       | Success                | Mutation score met or exceeded configured `thresholds.break`.                           |
| `1`       | Score Threshold Failed | Mutation score fell below required `thresholds.break`.                                  |
| `2`       | Configuration Error    | Invalid configuration file, unsupported schema, or missing plugin URL.                  |
| `3`       | Runtime Error          | Test runner crashed or instrumenter encountered invalid syntax.                         |
| `4`       | Internal Engine Error  | Unhandled engine defect or unexpected platform fault.                                   |
| `128 + n` | POSIX Process Signal   | Terminated by operating system signal `n` (for example, `130` for `SIGINT` / `Ctrl+C`). |

---

## 📡 Real-Time NDJSON Machine Output

When executing under automated pipelines or agent environments (`STRYKER_MODE=machine`), Stryker streams newline-delimited JSON events to `stdout`:

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

## 📦 Workspace Packages

| Package                                                                                                       | Purpose                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`@systemfsoftware/stryker-js`](packages/stryker-js)                                                          | Flagship CLI binary, run engine, and `./config` authoring surface (`defineConfig`, `mergeConfig`) |
| [`@systemfsoftware/stryker-js-vitest-runner`](packages/stryker-js-vitest-runner)                              | Vitest test runner plugin with sandbox isolation and per-test coverage analysis                   |
| [`@systemfsoftware/stryker-js-typescript-checker`](packages/stryker-js-typescript-checker)                    | TypeScript type checker plugin rejecting uncompilable mutants before running tests                |
| [`@systemfsoftware/stryker-js-html-reporter`](packages/stryker-js-html-reporter)                              | Interactive HTML mutation report generator (`reports/mutation/index.html`)                        |
| [`@systemfsoftware/stryker-js-angular`](packages/frameworks/angular)                                          | Framework plugin instrumenting `.html`, `.htm`, and `.vue` script regions                         |
| [`@systemfsoftware/stryker-js-svelte`](packages/frameworks/svelte)                                            | Framework plugin instrumenting Svelte 5 `.svelte` scripts and template expressions                |
| [`@systemfsoftware/stryker-framework-interface`](packages/frameworks/interface)                               | Types-only `Framework` contract a framework plugin implements                                     |
| [`@systemfsoftware/stryker-ignorer-kit`](packages/ignorers/kit)                                               | Authoring kit (`defineIgnorer`) and test harness (`testIgnorer`) for custom ignorers              |
| [`@systemfsoftware/stryker-ignorer-interface`](packages/ignorers/interface)                                   | AST node types and `Ignorer` contract                                                             |
| [`@systemfsoftware/stryker-ignorer-effect-schema-declarations`](packages/ignorers/effect-schema-declarations) | Ignorer filtering equivalent mutants on Effect Schema and Brand declarations                      |
| [`@systemfsoftware/stryker-ignorer-in-source-vitest-block`](packages/ignorers/in-source-vitest-block)         | Ignorer removing unreachable mutants inside `if (import.meta.vitest)` blocks                      |
| [`@systemfsoftware/stryker-test-contribution`](packages/stryker-test-contribution)                            | Test suite hygiene plugin enforcing unique mutant kills per test file                             |

---

## ❓ Frequently Asked Questions

<details>
<summary>How are plugins found?</summary>

List each plugin in `plugins` by its package name. The name is resolved from your project's own dependencies through the package's `exports`, never by scanning `node_modules`, so only packages you list are loaded. An explicit `file:` URL also works for a local build.

</details>

<details>
<summary>How do I avoid testing files that have not changed?</summary>

Enable incremental mutation caching by setting `incremental: true` in `stryker.config.ts`. Stryker caches test outcomes in `reports/stryker-incremental.json` and skips running tests against mutants in unchanged files.

</details>

<details>
<summary>Why choose in-memory V8 (`testRunner: 'vm'`) over Vitest?</summary>

The in-memory V8 runner executes pure TypeScript and JavaScript test suites directly in Node's VM context without spawning external processes. For algorithmic libraries, it cuts mutation test suite durations from minutes to seconds.

</details>

<details>
<summary>How can CI jobs parse real-time mutation progress?</summary>

Set `STRYKER_MODE=machine`, or run with one of the agent tool variables (`CLAUDECODE`, `CODEX_SANDBOX`, `AGENT`) set. Stryker streams typed NDJSON events to `stdout` including phase transitions, progress ticks, and the final verdict payload.

</details>

---

## 🤝 Contributing

Development setup, verification gates, and pull request guidelines are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).
