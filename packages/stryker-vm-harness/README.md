# `@systemfsoftware/stryker-vm-harness`

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](../../LICENSE)
[![npm version](https://img.shields.io/npm/v/@systemfsoftware/stryker-vm-harness.svg)](https://www.npmjs.com/package/@systemfsoftware/stryker-vm-harness)

In-process worker-thread harness that runs Vitest suites as native ESM for
Stryker mutation testing. Powers the `testRunner: 'vm'` runner in
`@systemfsoftware/stryker-js`. Pure `Cell` / `Sandwich` / `Workflow` core with
a thin imperative shell.

## Prerequisites

- Node.js `>=24.13.1`
- `vitest` installed in the project (the harness loads your suites, matchers,
  mocks, and snapshots through it)

## Install

```bash
pnpm add -D @systemfsoftware/stryker-vm-harness vitest
```

Consumed by `@systemfsoftware/stryker-js`, which spawns one harness worker
thread per test runner and drives it over a message protocol.

## How It Works

Each `@systemfsoftware/stryker-js` `vm` test runner owns one
`node:worker_threads` worker running a harness **session**
(`src/session.ts`): the host side spawns it lazily, posts run requests,
and awaits a response. On a wall-clock timeout the host terminates the worker
and spawns a fresh one for the next run. Worker `stdout`/`stderr` are captured
and discarded.

Inside the worker, the session installs interception hooks with
`module.registerHooks` (nothing uses `node:vm`) and executes one run at a time:
arm the active mutant, load the test graph, drain it, and collect per-test
results plus mutant coverage.

Isolation: every test file is imported under its own salt (`?salt=…` on the
file URL), so each file gets fresh module state. When your Vitest config sets
`isolate: false`, all files share one salt. Files under `node_modules` are
never salted and stay shared.

The harness-served `vitest` (and the `@effect/vitest` /
`@systemfsoftware/effect-gherkin-spec` shims) is handed to every module the
run loads that imports it, whatever its location: test files and helpers
inside the project, setup files and helpers in a sibling directory, and
workspace packages reached through a `node_modules` link or a package-manager
store. A setup file outside the project root registers its hooks against the
current test file's runner, so its `beforeEach` runs before each of that
file's tests.

Discovery: with no `testFiles` configured, the session asks your installed
`vitest` for its resolved test-file glob instead of guessing.

## Supported Vitest Surface

The matcher, mock, and snapshot implementations are the real ones from your
installed `vitest`; the harness only owns test registration. Supported:

- suites (`describe`, `it`, `test`), hooks, `.skip`, `.only`, `.todo`,
  `.each`, `it.fails`, retries, repeats, concurrent tests, conditional
  (`skipIf`/`runIf`) tests
- `expect` with asymmetric matchers, property matchers, and custom serializers
- snapshots: file, inline, and file-output snapshots
- `vi`: spies, stubs, timers, and module mocking (`vi.mock` with hoisting,
  `vi.doMock`/`vi.unmock`/`vi.resetModules`, factory and manual mocks)
- projects with per-project environments and setup files; `provide`/`inject`
- node, jsdom, and happy-dom environments; `setupFiles`; `globals: true`
- transforms: TypeScript/JSX, `.tsx`, Vue/Svelte/MDX, CSS and asset imports,
  JSON, aliases, `define`, `import.meta.env`, custom file extensions
- per-test mutant coverage for the dry run; timeout per run

## Unsupported

Vitest browser mode is the only refused feature. A session whose resolved
Vitest config enables browser mode fails init with:

```text
The in-memory 'vm' runner cannot run Vitest browser mode suites. Use testRunner: 'vitest' for suites that need browser mode.
```

Use the `testRunner: 'vitest'` runner (`@systemfsoftware/stryker-js-vitest-runner`)
for browser-mode suites.

## API

```ts
import { Session } from '@systemfsoftware/stryker-vm-harness'

const session = await Session.createVmSession(options)
const client = Session.createVmWorkerClient(options)
```

- `Session.createVmSession(options, plugins = Session.builtinPlugins)` — start
  a session in the current thread (used by tests and the worker entry).
  `options`: `sandboxWorkingDirectory`, `testFiles` (absolute paths; may be
  empty), optional `isolate` (default `true`) and `configFile`.
- `Session.createVmWorkerClient(options)` — spawn the `dist/worker.mjs` worker
  thread and drive it with `run(request)` / `terminate()`.
- One run is one `Session.VmRunRequest` (`kind: 'dry' | 'mutant'`, `timeoutMs`,
  optional `activeMutantId`, `testFilter`, `hitLimit`, `reloadEnvironment`);
  the answer is a `Session.VmRunResponse` (`complete` with per-test results,
  `timeout`, `error`, or `init-failed`). Test ids are
  `<file>#<suite names joined with ' > ' and the test name>`.

Every Vitest feature is a plugin in `src/plugins/`; sessions can pass
their own plugin list instead of `Session.builtinPlugins`.

## License

[Apache-2.0](../../LICENSE)
