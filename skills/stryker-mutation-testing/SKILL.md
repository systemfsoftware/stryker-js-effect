---
name: stryker-mutation-testing
description: Setup, configure, and execute Stryker mutation testing in any JS/TS codebase. Triggers on: 'setup mutation testing', 'stryker config', 'install stryker', 'run mutation tests', 'mutation coverage', 'surviving mutants', 'vitest mutation runner', 'custom ignorer', 'custom test runner'. Do not use for general unit test authoring without mutation testing.
---

# Stryker Mutation Testing

Configure, execute, and verify Stryker mutation testing using `@systemfsoftware/stryker-js` across TypeScript and JavaScript codebases.

## When to Activate

```yaml
- id: A1
  title: Activate on mutation testing setup or configuration
  do: trigger this skill when a project needs mutation testing, stryker.config.ts setup, runner configuration (Vitest, in-process `vm`, Command), or custom ignorer/runner development
  dont: install legacy @stryker-mutator/core or resolve installed plugin packages to file:// URLs with import.meta.resolve()
  check: the repository is a JavaScript or TypeScript project needing test efficacy verification
- id: A2
  title: Do NOT activate on general unit test authoring
  do: redirect to standard Vitest or Jest test authoring skills
  harm: injecting mutation testing workflows into standard unit testing slows development and complicates basic test writing
  check: the user is asking only for basic test creation with no mention of mutation testing, mutants, or test quality gates
```

## Decision Tree

```yaml
- id: D1
  title: Select Test Runner Architecture
  do: match project requirements to one of three runner strategies
  dont: force Vitest child-process runners for simple local loops or pure algorithmic modules
  check: the selected runner is supported by the project's dependencies and execution environment
```

| Project State                                  | Recommended Runner                                                          | Configuration                                                                   | Reference                          |
| ---------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| Modern TS repo using Vitest                    | `@systemfsoftware/stryker-js-vitest-runner`                                 | `testRunner: 'vitest'` in CI, `testRunner: 'vm'` locally                        | `references/decision-guide.md`     |
| Jest, Mocha, or custom test script             | Built-in `command` runner (zero extra plugins)                              | `testRunner: 'command'`, `commandRunner: { command: 'pnpm test' }`              | `references/decision-guide.md`     |
| Pure Node.js unit tests / zero child processes | Built-in `vm` runner (the default; zero extra plugins)                      | `testRunner: 'vm'`; omit `testFiles` to discover tests next to the mutated code | `references/decision-guide.md`     |
| Custom AST mutant skipping needed              | Custom AST ignorer via `@systemfsoftware/stryker-ignorer-kit`               | `plugins`, `ignorers: ['name']` (local file:URL)                                | `references/authoring-ignorers.md` |
| Custom test runner harness needed              | Custom worker RPC plugin via `@systemfsoftware/stryker-js-plugin-interface` | `plugins`, `testRunner: 'name'` (local file:URL)                                | `references/authoring-runners.md`  |

For deep comparison of execution models, read `references/decision-guide.md` (hash: `0bf2a6`).

---

## Core Rules

```yaml
- id: STRYK-R1
  title: Plugins Take Bare Package Names Resolved From the Project
  do: pass the package's bare name in every plugin field (`plugins`, `appendPlugins`, `ignorers`, `testRunner.plugin`, `checkers[].plugin`); use a `file://` URL only for an unpublished local build
  dont: wrap installed package names in `import.meta.resolve(...)` or commit resolved `file:///…/node_modules/…` URLs to the config
  harm: resolved absolute URLs pin the config to one machine's install layout, so the same config breaks on a teammate's checkout or CI
  check: pnpm exec stryker run --dryRunOnly succeeds without PluginLoadFailedError
- id: STRYK-R2
  title: Dual-Engine Workflow (In-Process vm Locally, Isolated CI Vitest)
  do: use the `isCi` parameter in `defineConfig(({ isCi }) => ...)` to set `testRunner: isCi ? 'vitest' : 'vm'`
  dont: run heavy child-process test runners for fast local iteration when the in-process `vm` runner is applicable
  harm: developers suffer 5-10x latency overhead locally, discouraging frequent mutation testing
  check: stryker.config.ts switches runner based on isCi
- id: STRYK-R3
  title: Exclude Tests, Types, and Fixtures from Mutate Globs
  do: add negative glob patterns (`!src/**/*.test.ts`, `!src/**/__tests__/**`, `!src/**/*.d.ts`) to the `mutate` array
  dont: mutate test files or ambient type declaration files
  harm: mutating tests creates false surviving mutants and invalid self-referential failure loops
  check: grep the mutation report for mutated test files; count must be zero
- id: STRYK-R4
  title: Ignorer Registration Travels as a Pair
  do: name the ignorer's package in `plugins` AND add the ignorer's exact string identifier to `ignorers` (for example `plugins: ['@systemfsoftware/stryker-ignorer-effect-schema-declarations']` with `ignorers: ['effect-schema-declarations']`)
  dont: specify `ignorers: ['effect-schema-declarations']` without naming its package in `plugins`
  harm: the host discovers ignorers only through loaded plugin modules, so an ignorer name whose package never loads leaves equivalent mutants in the score
  check: mutation report shows expected mutants with status 'Ignored' and the declared reason
```

---

## Workflow: Setup and Verification

```yaml
- id: W1
  title: Pre-flight and Stack Detection
  do: inspect package.json to identify test framework (vitest, jest, mocha) and check for tsconfig.json
  dont: guess runner configuration without reading dependencies
  check: test runner package and version are identified
- id: W2
  title: Dependency Installation
  do: install @systemfsoftware/stryker-js and required satellite plugins using the repository's package manager
  dont: install deprecated @stryker-mutator packages
  check: pnpm list (or npm/yarn equivalent) displays @systemfsoftware/stryker-js
```

```bash
# Recommended Vitest + TS setup
pnpm add -D @systemfsoftware/stryker-js \
  @systemfsoftware/stryker-js-vitest-runner \
  @systemfsoftware/stryker-js-typescript-checker
```

```yaml
- id: W3
  title: Author stryker.config.ts
  do: generate configuration using defineConfig with bare plugin package names and negative mutate globs
  dont: hand-craft JSON configuration files or omit type checking
  check: test -f stryker.config.ts
```

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig(({ isCi }) => ({
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

```yaml
- id: W4
  title: Dry-Run Preflight Gate
  do: execute stryker dry run to verify test suite health and runner discovery before mutating code
  dont: run full mutation testing if dry run has failing tests
  harm: all mutants on failing tests are misclassified and execution time is wasted
  check: pnpm exec stryker run --dryRunOnly exits 0
```

```bash
pnpm exec stryker run --dryRunOnly
```

```yaml
- id: W5
  title: Execute and Diagnose
  do: run mutation testing and target surviving mutants with --survivors
  dont: re-run the entire test suite across all mutants when fixing specific assertions
  check: final mutation score meets or exceeds thresholds.break
```

```bash
# Run full mutation testing
pnpm exec stryker run

# Re-test only surviving mutants after strengthening assertions
pnpm exec stryker run --survivors
```

---

## Workflow: Gate, Reproduce, Deliver

The same CLI carries a run into review and lets an editor or an agent drive it, so nothing parses a report by hand:

```bash
# Seed a committed baseline of accepted survivor ids, then gate pull requests on new ones
pnpm exec stryker gate --baseline .stryker-baseline.json --update-baseline
pnpm exec stryker run --since origin/main
pnpm exec stryker gate --baseline .stryker-baseline.json
pnpm exec stryker annotate --baseline .stryker-baseline.json

# Study and re-run one survivor, by id
pnpm exec stryker run --mutant <id>

# Let an agent or editor drive the run, and record what was worth doing
pnpm exec stryker mcp
pnpm exec stryker serve stdio
pnpm exec stryker feedback <id> --not-useful --reason "logging only"
```

```yaml
- id: W6
  title: Gate on New Survivors, Not a Flat Score
  do: keep a committed baseline of accepted survivor ids and run `stryker gate --baseline <file>` in CI, seeding or refreshing it with `--update-baseline`
  dont: fail the build on a flat mutation-score threshold, which hides new survivors in changed code and blocks on old ones in untouched code
  harm: a score gate says neither what regressed nor what to fix, so teams stop reading it
  check: a run with one new survivor fails and names only that survivor; `--update-baseline` rewrites the file with exactly the finished report's survivors
- id: W7
  title: Reproduce a Survivor Before Writing a Test
  do: read the survivor's reproducer from `reports/mutation/reproducers.json`, or re-run it with `stryker run --mutant <id>`, which reports its status, covering tests, and killing test
  dont: re-run the whole suite to study one survivor, and dont open the HTML report to find its diff
  harm: a full re-run spends minutes to answer a question one mutant id answers
  check: `stryker run --mutant <id>` exits 0 and reports the mutant with its covering tests
- id: W8
  title: Deliver Survivors Where the Reader Works
  do: annotate pull requests with `stryker annotate --baseline <file>`, add the `sarif` reporter for code scanning, and serve the run to editors and agents over `stryker serve stdio|socket` and `stryker mcp`
  dont: require a human or an agent to open a generated HTML report to find a survivor
  harm: survivors nobody sees are never fixed, and the gate fires after the code has merged
  check: a run writes `reports/mutation/mutation.sarif` and `reports/mutation/reproducers.json`, and `stryker annotate` prints one workflow command per surfaced survivor
- id: W9
  title: Record Usefulness Where the Run Can Read It
  do: judge a surfaced survivor with `stryker feedback <id> --useful|--not-useful --reason "<why>"`, or the MCP `report_usefulness` tool
  dont: leave the judgment in a chat thread or a review comment
  harm: the judgment never reaches the report directory, so no surface can act on it
  check: the report directory gains a `feedback` line naming the id, the judgment, and the reason
```

Assertions about specific mutants belong under `mutator: { mutantSetPolicy: 'full' }`. The default policy suppresses mutants a rule proves redundant — a replacement equal to the original, a duplicate already planted at the site, or the complement of a kept ordering mutant (`redundant-relational`: `a >= b` beside `a <= b` for `a < b`, run after all when its dominator does not run) — and reports each as `Ignored` with the rule id, so a fixture or configuration that claims those mutants must keep every variant.

## Gotchas

```yaml
- id: G1
  title: Resolved file:// URLs Committed to the Config
  do: keep bare package names in every plugin field; resolve a `file://` URL only for an unpublished local build
  dont: wrap installed packages in import.meta.resolve(...) or commit resolved file:///…/node_modules/… URLs
    harm: absolute URLs pin the config to one machine's install layout and break the same checkout elsewhere
    check: rg -n "file:///.*node_modules" stryker.config.ts exits without matches
- id: G2
  title: Surviving Mutants on Schema and Brand Declarations
  do: install @systemfsoftware/stryker-ignorer-effect-schema-declarations and add 'effect-schema-declarations' to ignorers
  dont: scatter // stryker-disable-next-line comments across data schemas
  harm: schema files become polluted with tooling comments and maintenance burden increases
  check: inspect report to verify schema declarations are marked Ignored
- id: G3
  title: Command Runner Used with testRunnerNodeArgs
  do: pass custom Node arguments directly inside commandRunner.command
  dont: specify testRunnerNodeArgs when testRunner is 'command'
  harm: command runner issues a warning and ignores testRunnerNodeArgs
  check: console logs show no warning regarding ignored node args
```

---

## References (load on demand)

| Reference                          | When to load (intent)                                                                         | Hash     |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| `references/decision-guide.md`     | When choosing between the in-process `vm`, Vitest, and Command runners                        | `0bf2a6` |
| `references/authoring-ignorers.md` | When creating a custom AST ignorer with `@systemfsoftware/stryker-ignorer-kit`                | `3d8b30` |
| `references/authoring-runners.md`  | When building a custom test runner worker with `@systemfsoftware/stryker-js-plugin-interface` | `81b8c7` |

### Reference Integrity Gate

Before loading any reference, verify its content hash matches the table below. A mismatched hash means the reference has changed and must be re-read.

| File                               | Hash     | Purpose  |
| ---------------------------------- | -------- | -------- |
| `references/authoring-ignorers.md` | `3d8b30` | `3d8b30` |
| `references/authoring-runners.md`  | `81b8c7` | `81b8c7` |
| `references/decision-guide.md`     | `0bf2a6` | `0bf2a6` |

## Critical Rules at Document End (lost-in-middle mitigation)

```yaml
- id: END1
  title: Always Verify with Dry Run First
  do: execute `pnpm exec stryker run --dryRunOnly` before launching a full mutation test
  dont: launch full mutation tests on an unverified or broken initial test suite
  harm: mutants tested against failing baseline tests produce false kills, corrupted state, and wasted hours of compute
  check: dry run exits 0 with 100% test pass rate
- id: END2
  title: Never Lower Thresholds to Hide Missing Assertions
  do: fix surviving mutants by sharpening test assertions or adding dedicated domain ignorers
  dont: lower thresholds.break to achieve green CI runs
  harm: defeated mutation testing provides false confidence while production bugs go undetected
  check: thresholds.break reflects the genuine quality bar of the repository
```
