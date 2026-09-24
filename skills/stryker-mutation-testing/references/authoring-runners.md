---
content_hash: 8d23a1
---

# Custom Test Runner Authoring Guide

A **Test Runner plugin** executes tests against mutant sandboxes and reports results (`Killed`, `Survived`, `Timeout`, `Error`).

In Stryker JS Effect v5, test runners are isolated worker processes communicating via RPC (`TestRunnerRpcs`) over stdio or IPC.

---

## 1. Architecture Overview

A test runner plugin consists of two parts:

1. **Host Entry Point (`index.ts`)**: Exported module discovered by Stryker's plugin loader. Exports `strykerPlugins` declaring the runner name and worker entrypoint.
2. **Worker Entry Point (`main.ts`)**: Spawned in worker processes. Runs an Effect RPC server implementing `TestRunnerRpcs`.

---

## 2. Host Entry Point (`index.ts`)

Export `strykerPlugins` with kind `'TestRunner'`:

```ts
import * as S from 'effect/Schema'

export const strykerPlugins = [
  {
    kind: 'TestRunner',
    name: 'my-custom-runner',
    workerEntry: new URL('./main.mjs', import.meta.url).href,
  },
] as const

// Optional: contribute a JSON schema for validating custom options in stryker.config.ts
export const strykerValidationSchema = S.toJsonSchemaDocument(
  S.Struct({
    myCustomRunner: S.optional(S.Struct({
      configFile: S.optional(S.String),
    })),
  }),
).schema
```

---

## 3. Worker Handlers (`worker-handlers.ts`)

Implement the `TestRunnerRpcs` interface:

| RPC Method     | Input                           | Output                   | Purpose                                                                                         |
| -------------- | ------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `capabilities` | `{}`                            | `TestRunnerCapabilities` | Declares whether the runner supports reload or static coverage (`{ reloadEnvironment: true }`). |
| `dryRun`       | `{ options: DryRunOptions }`    | `DryRunResult`           | Runs all tests once to establish a baseline and collect per-test coverage.                      |
| `mutantRun`    | `{ options: MutantRunOptions }` | `MutantRunResult`        | Runs tests with a specific mutant active; reports whether any test failed.                      |

```ts
import {
  type DryRunOptions,
  type DryRunResult,
  type MutantRunOptions,
  type MutantRunResult,
  TestRunnerFailed,
  TestRunnerRpcs,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { readWorkerOptionsFromEnv } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'

export const testRunnerHandlers = TestRunnerRpcs.toLayer(
  Effect.gen(function*() {
    const options = yield* readWorkerOptionsFromEnv

    return {
      capabilities: () => Effect.succeed({ reloadEnvironment: true }),

      dryRun: ({ options }: { readonly options: DryRunOptions }) =>
        Effect.tryPromise({
          try: async () => {
            // Execute your test suite
            // return { status: 'complete', tests: [{ id: '1', name: 'test 1', status: 'success', timeSpentMs: 12 }] }
            return { status: 'complete', tests: [] }
          },
          catch: (cause) =>
            new TestRunnerFailed({ phase: 'dryRun', runnerName: 'my-custom-runner', cause: String(cause) }),
        }),

      mutantRun: ({ options }: { readonly options: MutantRunOptions }) =>
        Effect.tryPromise({
          try: async () => {
            // Mutants are activated via process.env.__STRYKER_ACTIVE_MUTANT__ = options.activeMutant.id
            // If test fails: return { status: 'killed', killedBy: ['test 1'], nrOfTests: 1, timeSpentMs: 10 }
            // If test passes: return { status: 'survived', nrOfTests: 1, timeSpentMs: 10 }
            return { status: 'survived', nrOfTests: 0, timeSpentMs: 0 }
          },
          catch: (cause) =>
            new TestRunnerFailed({ phase: 'mutantRun', runnerName: 'my-custom-runner', cause: String(cause) }),
        }),
    }
  }),
)
```

---

## 4. Worker Entry Point (`main.ts`)

Launch the worker server with `@effect/platform-node`:

```ts
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { TestRunnerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import { workerServerLayer } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Layer from 'effect/Layer'

import { testRunnerHandlers } from './worker-handlers.js'

NodeRuntime.runMain(
  Layer.launch(
    workerServerLayer({
      rpcs: TestRunnerRpcs,
      handlers: testRunnerHandlers,
      schemaServices: Layer.empty,
    }),
  ),
)
```

---

## 5. Registering in `stryker.config.ts`

```ts
import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: 'my-custom-runner',
  plugins: [
    import.meta.resolve('./packages/my-custom-runner/dist/index.js'),
  ],
})
```
