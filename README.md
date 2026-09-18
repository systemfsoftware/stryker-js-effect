# stryker-js-effect

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Effect: 4.x](https://img.shields.io/badge/Effect-4.0_RC-purple.svg)](https://effect.website)
[![CI](https://github.com/systemfsoftware/stryker-js-effect/actions/workflows/ci.yml/badge.svg)](https://github.com/systemfsoftware/stryker-js-effect/actions)

> 🔬 **stryker-js-effect** is an Effect 4 mutation testing framework and drop-in alternative to `@stryker-mutator/core`.
> 🤖 Emits line-by-line NDJSON streams and classified exit codes designed for automated CI runs, test runners, and AI coding agents.
> ⚡ Real-time mutant streaming, cancel-safe partial reports, reliable incremental cache, and day-one TypeScript 7 support.

```bash
pnpm add -D @systemfsoftware/stryker-js
pnpm exec stryker run
```

---

## 🎯 Why Mutation Testing?

Code coverage only tells you which lines ran during tests; it cannot tell you if assertions catch broken logic. Mutation testing introduces small syntax and logic defects (mutants) into source files to verify test efficacy:

- 💀 **Killed**: A test failed while the mutant was active. The test caught the defect.
- 🧟 **Survived**: All tests passed despite the defect. Exposes missing test assertions.
- ⏳ **Timeout**: The mutant caused an infinite loop or hung process.
- 🚫 **No Coverage**: No test touched the mutated code path during dry run.

---

## ⚡ Key Differentiators vs Upstream StrykerJS

| Feature                 | Upstream StrykerJS                               | stryker-js-effect                                                                            |
| ----------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Output Protocol**     | TUI progress bar, terminal scrapers              | Real-time NDJSON stream on `stdout`                                                          |
| **Interrupted Runs**    | `Ctrl+C` / cancel yields 0 reports               | Emits partial report up to last completed mutant                                             |
| **Incremental State**   | `stryker-incremental.json` frequently goes stale | Reliable state validation surviving aborted runs                                             |
| **Agent / CI Mode**     | Generic CLI exit codes (`0` or `1`)              | Machine mode auto-detection (`AGENT`, `CLAUDECODE`, `CODEX_SANDBOX`) + classified exit codes |
| **Effect-TS Ecosystem** | Equivalent mutant noise on Schema & Brand types  | Dedicated `@systemfsoftware/stryker-ignorer-*` ignorers                                      |
| **Runtime Engine**      | Procedural JavaScript with mutable state         | Pure functional Effect 4 architecture with typed errors                                      |

---

## 📡 Machine-Readable NDJSON Stream

The CLI emits newline-delimited JSON events directly to `stdout`. Automated CI runners and AI agents can process results incrementally without parsing terminal escape codes:

```console
$ pnpm exec stryker run
{"kind":"stream","schemaVersion":"1.0","runId":"06FY3DSBM7TYC2RZQ0F3EGVZ88","mode":"machine","signal":"tty"}
{"kind":"phase","phase":"instrument","elapsedMs":102}
{"kind":"phase","phase":"dry-run","elapsedMs":6658}
{"kind":"plan","total":2}
{"kind":"tick","elapsedMs":8200,"completed":1,"total":2}
{"kind":"verdict","schemaVersion":"1.0","score":100,"thresholds":{"high":100,"low":80,"break":0},"counts":{"killed":2,"survived":0,"timeout":0,"noCoverage":0},"reportFile":"reports/mutation/mutation.json"}
```

### Event Protocol

Every mutation run emits a deterministic sequence of typed event objects:

| Event `kind` | Description                                 | Key Attributes                                |
| ------------ | ------------------------------------------- | --------------------------------------------- |
| `stream`     | Run initialization                          | `runId`, `mode`, `signal`, `schemaVersion`    |
| `phase`      | Phase transitions (`instrument`, `dry-run`) | `phase`, `elapsedMs`                          |
| `plan`       | Test plan prepared                          | `total` mutants planned                       |
| `tick`       | Progress heartbeat per batch                | `elapsedMs`, `completed`, `total`             |
| `verdict`    | Final run verdict                           | `score`, `thresholds`, `counts`, `reportFile` |
| `error`      | Fatal execution error                       | `failure`, `remediation`                      |

Machine mode activates automatically when `stdout` is non-interactive or when `AGENT`, `CLAUDECODE`, or `CODEX_SANDBOX` environment variables are present. Enforce manually with `STRYKER_MODE=machine`.

---

## 🚦 Classified Exit Codes

Granular exit codes allow automated systems to handle distinct failure classes without text scraping:

| Exit Code | Classification | Meaning                                                     |
| --------- | -------------- | ----------------------------------------------------------- |
| `0`       | Success        | Mutation score met or exceeded configured `break` threshold |
| `1`       | Verdict Failed | Mutation score fell below required `break` threshold        |
| `2`       | Config Error   | Invalid configuration or unresolvable options schema        |
| `3`       | Runtime Error  | Test runner crashed or instrumenter encountered invalid AST |
| `4`       | Internal Error | Unhandled engine defect or unexpected runtime fault         |
| `128 + n` | Process Signal | Terminated by POSIX signal `n` (`130` for `SIGINT`)         |

---

## 🚀 Quick Start

### 1. Install CLI and Plugins

```bash
pnpm add -D @systemfsoftware/stryker-js \
  @systemfsoftware/stryker-js-vitest-runner \
  @systemfsoftware/stryker-js-typescript-checker
```

### 2. Configure `stryker.config.ts`

Create `stryker.config.ts` in your project root:

```ts
export default {
  testRunner: 'vitest',
  plugins: [
    '@systemfsoftware/stryker-js-vitest-runner',
    '@systemfsoftware/stryker-js-typescript-checker',
  ],
  mutate: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  thresholds: {
    high: 100,
    low: 80,
    break: 100,
  },
}
```

### 3. Run Mutation Tests

```bash
pnpm exec stryker run
```

---

## 📦 Workspace Packages

This monorepo publishes a modular ecosystem of packages under the `@systemfsoftware` scope:

| Package                                                                                    | Role                                                                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`@systemfsoftware/stryker-js`](packages/stryker-js)                                       | The tool: the `stryker` binary, the run engine, and the `./config` authoring surface     |
| [`@systemfsoftware/stryker-js-instrumenter`](packages/stryker-js-instrumenter)             | AST mutation engine powered by OXC parser, and the mutant vocabulary                     |
| [`@systemfsoftware/stryker-js-plugin-interface`](packages/stryker-js-plugin-interface)     | Plugin boundary: RPC groups, payload schemas, typed failures, spawn contract             |
| [`@systemfsoftware/stryker-js-plugin-runtime`](packages/stryker-js-plugin-runtime)         | Plugin worker runtime: RPC server layer, options codec, telemetry, trace middleware      |
| [`@systemfsoftware/stryker-js-vitest-runner`](packages/stryker-js-vitest-runner)           | Vitest runner integration for mutation sandboxes                                         |
| [`@systemfsoftware/stryker-js-typescript-checker`](packages/stryker-js-typescript-checker) | TypeScript type-checker plugin validating mutants pre-execution                          |
| [`@systemfsoftware/stryker-js-html-reporter`](packages/stryker-js-html-reporter)           | Interactive HTML mutation report generator                                               |
| [`@systemfsoftware/stryker-ignorer-*`](packages/ignorers)                                  | Decoupled domain ignorers (Schema declarations, vitest blocks, Workflow.make boundaries) |
| [`@systemfsoftware/stryker-test-contribution`](packages/stryker-test-contribution)         | Suite hygiene plugin enforcing unique mutant kills per test file                         |

---

## ❓ Frequently Asked Questions

<details>
<summary><strong>How does this package family differ from upstream StrykerJS?</strong></summary>

`stryker-js-effect` is an Effect 4 native fork maintained by System F Software. It streams NDJSON mutant events in real time, emits partial reports on cancellation, guarantees clean incremental test caching, and includes purpose-built ignorer plugins for Effect-TS schemas.

</details>

<details>
<summary><strong>Why do mutants survive on my Effect Schema definitions?</strong></summary>

Schema definitions and branded type markers often produce equivalent mutants that cannot be observed or failed at runtime. Install `@systemfsoftware/stryker-ignorer-effect-schema-declarations` and enable `effect-schema-declarations` in your `stryker.config.ts` to filter them out automatically.

</details>

<details>
<summary><strong>What versions of Node.js and TypeScript are supported?</strong></summary>

Node.js 22.18.0 or later is required (`>=22.18.0`). Configuration files are TypeScript or ECMAScript modules (`stryker.config.ts`, `.mts`, `.js`, `.mjs`, and their `stryker.conf.*` twins). TypeScript 5.x through 7.x are supported out of the box.

</details>

---

## 🤝 Contributing

Development setup, verification gates, and pull request guidelines are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).
