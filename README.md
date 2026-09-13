# stryker-js-effect

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Effect: 4.x](https://img.shields.io/badge/Effect-4.0_RC-purple.svg)](https://effect.website)
[![CI](https://github.com/systemfsoftware/stryker-js-effect/actions/workflows/ci.yml/badge.svg)](https://github.com/systemfsoftware/stryker-js-effect/actions)

> 🔬 **stryker-js-effect** is the next-generation mutation testing framework for TypeScript and JavaScript, rebuilt natively on Effect 4.
> 🤖 Line-by-line machine-readable NDJSON stream output and structured exit codes designed directly for CI workflows, automation runners, and AI coding agents.
> 🛡️ Built for high-assurance codebases where line coverage is not enough and behavioral verification is required.

```bash
npm install --save-dev @systemfsoftware/stryker-js-cli
npx stryker run
```

---

## 🎯 What is Mutation Testing?

Code coverage metrics only report which lines of source code your test runner executed; they cannot prove that your test assertions notice when business logic breaks. Mutation testing measures assertion strength by introducing deliberate syntax and logic alterations into your source files:

- 💀 **Killed**: A test failed while the mutant was active, proving that your test suite caught the defect.
- 🧟 **Survived**: All tests passed despite the mutant, exposing an untested logic branch or missing assertion.
- ⏳ **Timeout**: The mutant induced an infinite loop or hanging operation, caught by sandbox execution limits.
- 🚫 **No Coverage**: No test touched the mutated statement during the baseline dry run.

A 100% mutation score demonstrates that every meaningful branch and condition is backed by a test that fails when behavior changes.

---

## 📡 Machine-Readable Stream Output

The `stryker` CLI emits newline-delimited JSON (NDJSON) events directly to `stdout`. Continuous integration pipelines, monitoring workers, and AI coding agents can stream and parse these events line-by-line in real time without scraping ASCII progress bars or filtering terminal escape codes:

```console
$ npx stryker run
{"kind":"stream","schemaVersion":"1.0","runId":"06FY3DSBM7TYC2RZQ0F3EGVZ88","mode":"machine","signal":"tty"}
{"kind":"phase","phase":"instrument","elapsedMs":102}
{"kind":"phase","phase":"dry-run","elapsedMs":6658}
{"kind":"plan","total":2}
{"kind":"verdict","schemaVersion":"1.0","score":100,"thresholds":{"high":100,"low":80,"break":0},"counts":{"killed":2,"survived":0,"timeout":0,"noCoverage":0},"reportFile":"reports/mutation/mutation.json"}
```

### Event Stream Protocol

Every mutation run generates a predictable sequence of typed event objects:

| `kind`    | Trigger                   | Payload Attributes                            |
| --------- | ------------------------- | --------------------------------------------- |
| `stream`  | Start of run              | `runId`, `mode`, `signal`, `schemaVersion`    |
| `phase`   | Pipeline phase transition | `phase`, `elapsedMs`                          |
| `plan`    | Mutant test plan ready    | `total`                                       |
| `tick`    | Progress heartbeat        | `elapsedMs`, `completed`, `total`             |
| `verdict` | Mutation run completion   | `score`, `thresholds`, `counts`, `reportFile` |
| `error`   | Fatal execution error     | `failure`, `remediation`                      |

Machine mode activates automatically whenever `stdout` is not an interactive terminal or when agent environment flags such as `AGENT`, `CLAUDECODE`, or `CODEX_SANDBOX` are detected. You can also explicitly enforce machine mode by setting `STRYKER_MODE=machine`.

---

## 🚦 Classified Exit Codes

Stryker provides deterministic, granular exit codes so automation systems immediately recognize the failure mode without text parsing:

| Exit Code | Classification | Meaning                                                     |
| --------- | -------------- | ----------------------------------------------------------- |
| `0`       | Success        | Mutation score cleared the configured `break` threshold     |
| `1`       | Verdict Failed | Mutation score fell below the required `break` threshold    |
| `2`       | Config Error   | Invalid configuration schema or unresolvable options        |
| `3`       | Runtime Error  | Sandboxed test runner crashed or instrumenter failed        |
| `4`       | Internal Error | Unhandled engine defect or unexpected internal fault        |
| `128 + n` | Process Signal | Terminated by POSIX signal `n` (such as `130` for `SIGINT`) |

When multiple conditions occur during execution, the highest pending exit class wins so critical runtime errors take precedence over standard test verdict failures.

---

## 🚀 Quick Start

### 1. Install CLI

Add the CLI package to your repository development dependencies:

```bash
pnpm add -D @systemfsoftware/stryker-js-cli
```

### 2. Configure `stryker.config.json`

Create a `stryker.config.json` configuration file at your project root:

```json
{
  "$schema": "./node_modules/@systemfsoftware/stryker-js/schema/stryker-schema.json",
  "testRunner": "vitest",
  "plugins": [
    "@systemfsoftware/stryker-js-vitest-runner",
    "@systemfsoftware/stryker-js-typescript-checker"
  ],
  "mutate": [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**"
  ],
  "thresholds": {
    "high": 100,
    "low": 80,
    "break": 100
  }
}
```

### 3. Run Mutation Tests

Execute the mutation testing run:

```bash
npx stryker run
```

---

## 📦 Workspace Packages

This monorepo publishes a modular ecosystem of Effect 4 packages, plugins, and runners:

| Package                                                                                    | Description                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`@systemfsoftware/stryker-js-cli`](packages/stryker-js-cli)                               | Terminal-facing CLI binary emitting machine-readable NDJSON streams       |
| [`@systemfsoftware/stryker-js`](packages/stryker-js)                                       | Pure core domain vocabulary: ports, mutant schemas, exit classifications  |
| [`@systemfsoftware/stryker-js-engine`](packages/stryker-js-engine)                         | Host-neutral mutation execution engine and test orchestration lifecycle   |
| [`@systemfsoftware/stryker-js-instrumenter`](packages/stryker-js-instrumenter)             | AST instrumenter placing mutants via OXC parser and Babel transforms      |
| [`@systemfsoftware/stryker-js-vitest-runner`](packages/stryker-js-vitest-runner)           | High-performance test-runner plugin integrating natively with Vitest      |
| [`@systemfsoftware/stryker-js-typescript-checker`](packages/stryker-js-typescript-checker) | Fast type checker plugin validating mutants before execution (TS7 native) |
| [`@systemfsoftware/stryker-js-html-reporter`](packages/stryker-js-html-reporter)           | Interactive HTML mutation report generator using custom elements          |
| [`@systemfsoftware/stryker-plugins`](packages/stryker-plugins)                             | Domain-specific ignorers for Effect Schema brands and tagged variants     |
| [`@systemfsoftware/stryker-test-contribution`](packages/stryker-test-contribution)         | Evaluator plugin enforcing that each test file kills distinct mutants     |

---

## ✨ Key Capabilities

- 🧬 **Effect 4 Architecture**: Pure domain core with typed errors, explicit resource boundaries, and structured concurrency.
- 🤖 **Agent-First Streaming**: Native line-by-line NDJSON event streaming designed for automated parsers, IDE tools, and AI agents.
- ⚡ **OXC Speed**: High-performance AST parsing and mutant placement across modern TypeScript and ECMAScript.
- 🔍 **Effect Schema Ignorers**: Built-in plugins to ignore equivalent mutants on Schema brand definitions and tagged union types.
- 🎯 **Test Contribution Tracking**: Evaluator plugins ensuring every test file contributes unique mutant kills to the overall suite.

---

## ❓ Frequently Asked Questions

<details>
<summary><strong>How does this package family differ from upstream StrykerJS?</strong></summary>

This repository is an Effect 4 native fork maintained by System F Software. It restructures the mutation engine into pure functional pipelines, replaces terminal UI scrapers with structured NDJSON streaming, and provides first-class plugins for Effect-TS applications.

</details>

<details>
<summary><strong>Why do mutants survive on my Effect Schema definitions?</strong></summary>

Schema definitions and branded type markers often produce equivalent mutants that cannot be observed or failed at runtime. Install `@systemfsoftware/stryker-plugins` and enable `effect-schema-ignorer` in your `stryker.config.json` to filter them out automatically.

</details>

<details>
<summary><strong>What versions of Node.js are supported?</strong></summary>

All packages require Node.js 20 or later (`>=20.0.0`, with CLI packages targeting Node.js `>=20.19.0`).

</details>

---

## 🤝 Contributing

Development setup, verification gates, and pull request guidelines are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).
