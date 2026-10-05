# `@systemfsoftware/stryker-js`

The modern mutation testing framework for JavaScript and TypeScript.
A ground-up, breaking-change fork of `@stryker-mutator/core` built with Effect 4:
provides the `stryker` executable, the `vm` and `vitest` test runners, and the
typed `./config` authoring surface.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-js
```

## Quick Start: Vitest Runner

For TypeScript codebases using Vitest:

```bash
pnpm add -D @systemfsoftware/stryker-js \
  @systemfsoftware/stryker-js-vitest-runner \
  @systemfsoftware/stryker-js-typescript-checker
```

Create `stryker.config.ts` in your project root:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vitest',
  checkers: ['typescript'],
  plugins: [
    '@systemfsoftware/stryker-js-vitest-runner',
    '@systemfsoftware/stryker-js-typescript-checker',
  ],
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
  ],
  thresholds: {
    high: 90,
    low: 70,
    break: 80,
  },
})
```

Run mutation testing:

```bash
pnpm exec stryker run
```

## Zero-Plugin Built-in Runners

The `vm` runner is the default and needs no plugin packages: `testRunner: 'vm'`
runs Vitest itself, on Vitest's isolated `threads` pool, through the project's
own `vitest` install (`vitest` must be installed). With no `testFiles`
configured, Vitest selects the test files from your config, exactly as
`vitest run` does. The runner reports the same test ids, outcomes and
per-mutant verdicts as `vitest run`. Set `testFiles` explicitly, or pick one of
the runners below, to take control.

### 1. Shell Command Runner (`testRunner: 'command'`)

Execute any test suite without extra plugins:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'command',
  commandRunner: {
    command: 'npm test',
  },
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
```

### 2. The `vm` Runner (`testRunner: 'vm'`)

Runs the Vitest runner on Vitest's isolated `threads` pool. Each test file keeps
Vitest's own per-file isolation, and module mocking, snapshots, environments,
setup files, projects and custom transforms behave as they do under
`vitest run`. A Vitest config that enables browser mode is refused with an
error naming `testRunner: 'vitest'`; pick the `vitest` runner for those.

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['test/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
```

Suites that need Vitest's `forks` pool (for example `process.chdir`, or native
addons that are not thread-safe) use `testRunner: 'vitest'` with the
`@systemfsoftware/stryker-js-vitest-runner` plugin instead.

## Configuration API (`@systemfsoftware/stryker-js/config`)

The `./config` subpath exports the typed configuration authoring surface, including the `StrykerConfig` type naming the partial options a config file writes: a config annotated `const config: StrykerConfig = defineConfig({ ... })` typechecks and loads.

```ts
import { defineConfig, type StrykerConfig } from '@systemfsoftware/stryker-js/config'
```

### `defineConfig(options | configFactory)`

Identity function providing strict autocompletion and type checking without runtime dependencies. Can take a configuration object or a factory receiving `ConfigEnv`:

```ts
export default defineConfig(({ isCi, command }) => ({
  testRunner: 'vitest',
  plugins: ['@systemfsoftware/stryker-js-vitest-runner'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  concurrency: isCi ? 2 : 4,
}))
```

### `mergeConfig(base, overrides)`

Deeply merges configuration presets. Keys in records merge recursively; scalar values and arrays in `overrides` completely replace base values:

```ts
import { mergeConfig } from '@systemfsoftware/stryker-js/config'
import baseConfig from './stryker.base.config.ts'

export default mergeConfig(baseConfig, {
  concurrency: 8,
  mutate: ['packages/core/src/**/*.ts'],
})
```

## CLI Usage and Flags

```bash
# Run mutation testing
pnpm exec stryker run [options]

# Mutate specific files only
pnpm exec stryker run --mutate "src/auth/*.ts"

# Scope the run to lines changed since a git ref
pnpm exec stryker run --since origin/main

# Re-run named mutants from the previous report
pnpm exec stryker run --mutant <id,...>

# Re-test only surviving mutants from prior run
pnpm exec stryker run --survivors

# Incremental caching is on by default; re-verify every mutant instead
pnpm exec stryker run --full

# Run with specific concurrency
pnpm exec stryker run --concurrency 4

# Merge partial mutation reports from parallel CI shards
pnpm exec stryker merge-reports --parts reports/shards --out reports/mutation

# Fail on survivors absent from a committed baseline
pnpm exec stryker gate --baseline .stryker-baseline.json

# Name every mutant whose status differs between two reports
pnpm exec stryker compare --baseline reports/mutation-report.json --fresh reports/fresh.json

# Annotate a pull request at each surfaced survivor
pnpm exec stryker annotate --baseline .stryker-baseline.json

# Judge one surfaced survivor, or drive runs from an editor or an agent
pnpm exec stryker feedback <id> --not-useful --reason "logging only"
pnpm exec stryker serve stdio
pnpm exec stryker mcp
```

`stryker run --since <ref>` takes the merge base of `<ref>` and the working tree, diffs it at `--unified=0`, and intersects the changed lines with `mutate`; it falls back to a full run when the Stryker config, a test-runner config, `package.json`, or the lockfile changed. `stryker run --mutant <id,...>` admits each id against the previous report (`reports/mutation/mutation.json`), restricts the run to those mutants' files, and emits each one's status, covering tests, killing test, and a `stryker run --mutant <id>` reproducer. `stryker gate` exits non-zero on survivors missing from its baseline, `stryker compare` exits `1` on a status mismatch after subtracting a `--noise` file, and `stryker annotate` prints GitHub workflow commands at each surfaced survivor.

A mutation run only starts on main CI. `stryker run` — and the programmatic `run`/`strykerCell` entry, the MSP `mutationTest` request, and the MCP `rerun_mutant` tool — refuses to start unless `GITHUB_ACTIONS` is `true`. A refused run exits non-zero and ends the machine stream with a `refused` event naming the rule (`mutation-runs-on-main-ci`). Dry runs (`--dryRunOnly`), `--version`, config and help commands, the MSP `discover` request, and the read-only MCP tools are unaffected. `stryker serve stdio|socket` speaks the Mutation Server Protocol and `stryker mcp` serves MCP over stdio.

## Output Modes

Human output is the default, whether or not `stdout` is a terminal. A machine consumer opts into the NDJSON event stream explicitly:

```bash
pnpm exec stryker run --json                # wire records on stdout, diagnostics on stderr
STRYKER_MODE=machine pnpm exec stryker run  # the same, named by environment
```

`--format text` names the human format explicitly; `--json` together with `--format text` is a usage error (exit 2). Under `--json`, `stdout` carries wire records and nothing else — progress lines and log output stay on `stderr`. Every run also writes the same records to `reports/mutation-stream.jsonl` (`--progressStreamFile`) in both modes, which is the artifact `stryker merge-reports` rebuilds a shard's partial report from.

## Reporters, Sidecars, and Verdict Reuse

`reporters` defaults to `['clear-text', 'progress', 'html']`. Add `sarif` to also write `reports/mutation/mutation.sarif` (SARIF 2.1.0, named from `jsonReporter.fileName`): each survivor is a `warning` result, each no-coverage mutant a `note`, the fingerprint is the mutant's content id, and the log is capped at 5,000 results. Every run writes `reports/mutation/reproducers.json`: one entry per mutant in the report, holding its mutated-lines diff and the `stryker run --mutant <id>` command that reproduces it.

Incremental reuse is on by default: an unchanged mutant whose covering tests are unchanged is re-used and the verdict records its `incrementalMode` (`incremental` or `full`). Pass `--full` to re-verify every mutant, ignoring the cache and the persisted dry run. The incremental cache is keyed by content: a mutant's id, the import-closure digest of its covering tests, the run inputs, the verdict-semantics version, and the mutant-set policy. Nothing in the key names a shard, branch, report path, or machine, so verdicts from different runs union and are reused wherever their inputs match. `incrementalSources` accepts globs of further incremental reports to union beside `incrementalFile`, which is how a sharded CI workspace reuses the reports it restored from other shards. Each run's stream carries a `reuse` line with the reused, ran, and per-reason refused counts, and an unchanged project reuses its persisted initial test run instead of repeating it.

`mutator.mutantSetPolicy` defaults to `'default'`, which suppresses the mutants a rule proves redundant — a relational replacement outside the sufficient set, a conditional that collapses to a literal, a replacement equal to the original code, or a duplicate already planted at the site — and records the rule id in the mutant's report entry. Set `mutator: { mutantSetPolicy: 'full' }` to keep every variant. `surfacing` (`{ perLine: 1, perFile: 7 }`) caps how many survivors reach the review surfaces and SARIF, without changing what the engine computes.

### Upgrading from 13.x: the mutant set changed in 14.0.0

14.0.0 made `'default'` the default `mutator.mutantSetPolicy`; 13.x generated what `'full'` generates now. A score produced under one policy grades a different mutant set from a score under the other, so the two are not comparable: removing a killed mutant lowers the score, removing a survivor raises it. Every run records its policy (the stream's `verdict.mutantSetPolicy` and the incremental report), and a cached verdict from the other policy is refused with `policyChanged`. To compare against a 13.x baseline, or to keep grading the 13.x mutant set, set `mutator: { mutantSetPolicy: 'full' }`.

## Programmatic API

### Effect 4 Native Interface

```ts
import { NodeRuntime } from '@effect/platform-node'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'

NodeRuntime.runMain(
  Engine.strykerCell({
    mutate: ['src/**/*.ts'],
    testRunner: 'command',
  }).pipe(Effect.provide(Engine.nodePlatformLayer)),
)
```

### Vanilla Promise Interface (`./promises`)

For non-Effect environments:

```ts
import { run } from '@systemfsoftware/stryker-js/promises'

const verdict = await run({
  testRunner: 'command',
  commandRunner: { command: 'pnpm test' },
})

console.log(`Mutation score: ${verdict.score}%`)
```

## Published Subpaths

| Subpath      | Description                                                               |
| ------------ | ------------------------------------------------------------------------- |
| `.`          | Main entry point: `strykerCell`, runtime layers, and error schemas        |
| `./config`   | Config authoring surface (`defineConfig`, `mergeConfig`, `StrykerConfig`) |
| `./promises` | `run()` wrapper returning standard JavaScript promises                    |

## License

[Apache-2.0](../../LICENSE)
