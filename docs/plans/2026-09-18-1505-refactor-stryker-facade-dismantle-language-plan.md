---
title: Collapse Stryker Facade and Dismantle Language Package
type: refactor
date: 2026-09-18
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Collapse Stryker Facade and Dismantle Language Package

## Destructive Review Report

### Phase 1: Assumptions Surfaced

1. **The Layer-Bucket Assumption:** Shared types and schemas require an independent horizontal package (`stryker-js-language`) to prevent circular dependencies.
2. **The CLI/Engine Split Assumption:** The CLI binary (`apps/stryker-js-cli`) and the execution orchestrator (`packages/stryker-js-engine`) represent distinct architectural layers that justify separate published packages.
3. **The Micro-Package Assumption:** To dissolve `language`, the repository must introduce multiple new fine-grained packages (`stryker-core`, `stryker-config`, `stryker-metrics`).

### Phase 2: Mutation Lens

- **Selected:** Scope Challenge (rotated from prior cycle)
- **Rationale:** The repository accumulated 20 packages through horizontal slicing. Examining package existence against the canon _“A Package Is Earned by a Binder or Contamination, Not Size”_ challenges every boundary that lacks an external peer dependency or platform quarantine.

### Phase 3: Divergence Phase

- **Pre-Validation:**
  - `packages/stryker-js-engine` has exactly one consumer package in production: `apps/stryker-js-cli` (`apps/stryker-js-cli/src/Cli.ts:6-12`). No other product package imports it (excluding its own internal test suites).
  - `apps/stryker-js-cli` exports zero code (`exports: { "./package.json": "./package.json" }`), forcing consumers to look elsewhere for config types.
  - `stryker-js-language/src/index.ts` re-exports 168 disparate symbols across 10 unrelated subsystems.
- **Lens Applied:** Scope Challenge
- **3 Failures Under This Lens:**
  1. _Artificial boundary between CLI and Engine:_ Splitting CLI and Engine into two packages creates a pass-through layer with zero external consumers while severing config authoring from execution.
  2. _Unearned Package Proliferation:_ Creating `stryker-core` or `stryker-config` packages violates the earning criterion (`package-earned-criterion.md` A4): config has neither a third-party binder nor substrate contamination; it is an unearned package that belongs as a subpath export.
  3. _Inverted Consumer Flow:_ An end user must install `@systemfsoftware/stryker-js-cli` to run tests, but must import from `@systemfsoftware/stryker-js-language` to type their configuration file.
- **Diverged Draft:** Collapse CLI, Engine, Config, Metrics, Core Reporters, and built-in runners (`command`, `vm`) into a single flagship package `@systemfsoftware/stryker-js`. Expose configuration via the subpath `@systemfsoftware/stryker-js/config`. Move the standalone container E2E harness from `apps/stryker-js-cli-e2e` to `test/e2e`. Maintain separate packages _only_ where an external binder exists (`stryker-js-instrumenter` for heavy AST parsers; `stryker-js-plugin-interface` for frozen worker RPCs; plugins for peers).

### Phase 4: Convergence Phase

#### Delta Report

- **Lens Applied:** Scope Challenge
- **Kept:**
  - `stryker-js-instrumenter` as a dedicated package (earned by `oxc-parser`, `oxc-walker`, and optional peer `svelte`).
  - `stryker-js-plugin-interface` as a dedicated package (earned as a frozen wire contract for out-of-process worker plugins).
  - Modular satellite plugins (`vitest-runner`, `typescript-checker`, `html-reporter`, `ignorers/*`).
- **Replaced:**
  - `apps/stryker-js-cli` + `packages/stryker-js-engine` → `@systemfsoftware/stryker-js` (single unified tool).
  - `apps/stryker-js-cli-e2e` → `test/e2e` (top-level singular test directory for standalone test workspaces).
  - `packages/stryker-js-language` → Dissolved completely into vertical owners (`instrumenter`, `plugin-interface`, `stryker-js`).
- **Added:**
  - `@systemfsoftware/stryker-js/config` subpath export with `defineConfig`, `ConfigEnv`, `mergeConfig`, and `StrykerConfig`.
  - Built-in in-memory `testRunner: 'vm'` using `node:vm` in `Layer.effect` with defect semantics (`Effect.promise`) for zero-spawn microsecond execution.
- **Removed:**
  - Proposal for intermediate `stryker-core`, `stryker-config`, or `stryker-metrics` packages (rejected as unearned layer buckets).

#### Remediation Report

| # | Failure                                         | Class | Resolution                                                                               | Research                                                           |
| - | ----------------------------------------------- | ----- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1 | CLI/Engine split is an artificial boundary      | Clear | Collapse both into `packages/stryker-js` hosting `bin.stryker` and `.`                   | Verified: Engine has 0 non-CLI product consumers                   |
| 2 | Config package is an unearned boundary          | Clear | Export configuration via `./config` subpath of `@systemfsoftware/stryker-js`             | Grounded in `package-earned-criterion.md` & Vitest pattern         |
| 3 | `language` barrel creates circular blast radius | Clear | Move AST types to `instrumenter`, worker RPC to `plugin-interface`, rest to `stryker-js` | Forwarding shims in `language` prevent broken intermediate commits |

---

## Goal Capsule

- **Objective:** Provide a single installable package (`@systemfsoftware/stryker-js@5.0.0`) that supplies the `stryker` executable, built-in runners (`command`, `vm`), and a first-class `@systemfsoftware/stryker-js/config` authoring surface (`defineConfig`, `ConfigEnv`, `mergeConfig`), while eliminating the unmaintained 168-symbol barrel package `packages/stryker-js-language` by returning types to their vertical domain owners and relocating the E2E testbed to `test/e2e`.
- **Means:** Unify CLI and Engine into `packages/stryker-js` with `./config` subpaths; relocate AST types to `instrumenter`, RPC schemas to `plugin-interface`, and execution/reporting/config into `stryker-js` using temporary forwarding shims to maintain green CI throughout migration; move E2E tests to `test/e2e` (KTD1–KTD7).
- **Authority Hierarchy:** Repo Constitution (`CONSTITUTION.md`) > `STRATEGY.md` > This Plan.
- **Stop Conditions:** Do not delete `stryker-js-language` until all 104 consumer files (source, tests, and E2E fixtures) have been repointed and `pnpm typecheck` confirms zero remaining imports.
- **Execution Profile:** Multi-unit refactor executed through `ce-work`, verified with unit schema laws, sociable integration tests, and the sparse E2E container suite.

---

## Product Contract

### Summary

Stryker configuration today is either untyped or forces users to manually import from an internal package (`@systemfsoftware/stryker-js-language`), because the CLI binary package (`@systemfsoftware/stryker-js-cli`) exports no modules or types. Concurrently, `stryker-js-language` has degenerated into an unearned 168-export barrel package connecting 10 disparate domains. This refactor unifies CLI and Engine into `@systemfsoftware/stryker-js`, introduces Vitest-grade `defineConfig` ergonomics under `@systemfsoftware/stryker-js/config`, adds a zero-dependency in-memory V8 `vm` runner, relocates the E2E test harness to `test/e2e`, and dissolves `stryker-js-language` by migrating all 104 workspace consumer files to vertical domain owners.

### Problem Frame

1. **Fragmented Consumer DX:** A user installs `@systemfsoftware/stryker-js-cli` to get the binary, but must reach into an internal package (`@systemfsoftware/stryker-js-language`) to get TypeScript configuration types.
2. **Defective Authoring Types:** Documentation (`Config.ts:1402`) instructs users to annotate configs with `@type {StrykerOptions}` (the fully-resolved type with ~45 required fields) rather than an input type. There is no `defineConfig` helper, no function form receiving environment context (`ConfigEnv`), and no `mergeConfig` for preset composition.
3. **Layer-Bucket Anti-Pattern:** `stryker-js-language` separates types from the modules that compute them, violating the core doctrine _Package by Feature, Not Layer_ (`package-by-feature-not-layer.md`), causing widespread cache invalidation across Turbo tasks.
4. **Test Harness Misclassification:** The standalone container-backed integration testbed is misnamed under `apps/stryker-js-cli-e2e` when it is not a deployable application, but a private top-level test workspace.

### Requirements

- **R1: Single Published Flagship Package (`@systemfsoftware/stryker-js`)**
  The repository shall publish `@systemfsoftware/stryker-js` providing both the `stryker` binary executable (`bin: { "stryker": "./dist/main.mjs" }`) and the programmatic execution engine. Versioning will advance to `5.0.0` to supersede the legacy `4.0.0` release.
- **R2: Subpath Configuration Seam (`@systemfsoftware/stryker-js/config`)**
  `@systemfsoftware/stryker-js` shall declare a `./config` subpath export exposing `defineConfig`, `ConfigEnv`, `mergeConfig`, `StrykerConfig` (input type), and `StrykerOptions` (resolved type). To comply with `CONST-N2` (no duplicate export paths across subpaths), these configuration types and helpers shall be exported exclusively from `./config` and omitted from the root export `.`.
- **R3: Identity `defineConfig` with Environment Overloads**
  `defineConfig` shall be an identity function preserving literal types, accepting an object, a promise, or a function receiving `ConfigEnv` (`command: 'run' | 'merge-reports'`, `isDryRun: boolean`, `mode: OutputMode`, `isCi: boolean`).
- **R4: Preset Composition via `mergeConfig`**
  `mergeConfig` (distinct from the internal `mergeConfigs` parent/child extends resolver) shall compose default and override configurations. It deep-merges option objects, preserves scalar overrides, and replaces (rather than appends to) default plugin globs when an explicit plugin list is supplied.
- **R5: Built-in Core Reporters**
  Terminal framing (`clear-text`), progress indicators (`progress`), machine streaming (`progress-stream`), and JSON output (`json`) shall be built directly into `@systemfsoftware/stryker-js`. Browser-asset reporters (`@systemfsoftware/stryker-js-html-reporter`) remain modular satellite plugins.
- **R6: Built-in `vm` Test Runner**
  `@systemfsoftware/stryker-js` shall provide a zero-dependency in-memory V8 test runner (`testRunner: 'vm'`), enabling instant local mutation testing in `check:local` and `test/e2e` without manual bundling. During the preparation/instrumentation phase, Stryker transparently compiles or strips TypeScript syntax from test files in-memory in ~10ms (`node:module.stripTypeScriptTypes` or `oxc-transform`) into a single `new vm.Script(jsCode)`. The hot mutation loop evaluates this script in fresh V8 contexts (`script.runInContext(context)`) in <1ms per mutant without spawning child processes. Dynamic import of `node:vm` lives in `Layer.effect` using `Effect.promise` with defect semantics (`Cause.Die`), failing fast on platform environment panics while reserving the typed `E` channel for domain outcomes.
- **R7: Vertical AST Domain Ownership (`stryker-js-instrumenter`)**
  `packages/stryker-js-instrumenter` shall own AST mutation models (`Mutant`, `MutantRunPlan`, `MutationRange`, `Location`, `MutatorDescriptor`, `INSTRUMENTER_CONSTANTS`, `FileDescription`, `MutateDescription`), eliminating downstream dependency on a shared language package.
- **R8: Frozen Worker RPC Seam (`stryker-js-plugin-interface`)**
  `packages/stryker-js-plugin-interface` shall own out-of-process worker RPC protocols (`TestRunner`, `Checker`, `CheckResult`, `DryRunResult`, `ExitClass`), decoupling runner/checker plugins from engine internals.
- **R9: Relocate E2E Testbed to `test/e2e`**
  `apps/stryker-js-cli-e2e` shall be moved to `test/e2e`, establishing a clear distinction between internal colocated tests (`packages/*/tests/`) and standalone integration test workspaces (`test/`).
- **R10: Complete Deletion of `stryker-js-language`**
  `packages/stryker-js-language` shall be completely removed from the repository once all 104 consumer files are migrated to vertical domain owners.

### Success Criteria

- **Zero-Friction Config:** An end user can install `@systemfsoftware/stryker-js` and write `import { defineConfig } from '@systemfsoftware/stryker-js/config'` with full auto-complete and zero auxiliary package installations.
- **Linear Plugin Test Decoupling:** Plugins and ignorers can be verified end-to-end without pulling in Vitest or Jest, using the built-in `command` or `vm` runner to prevent $N \times M$ combinatorial bloat.
- **Clean Workspace Dependency Graph:** `git grep '@systemfsoftware/stryker-js-language'` and `git grep '@systemfsoftware/stryker-js-cli'` yield zero matches in code and package manifests.
- **Verified Gate Parity:** `pnpm check:ci` passes cleanly across the workspace with zero regressions.

---

## Planning Contract

### Key Technical Decisions

- **KTD1: Unified Flagship Package (`@systemfsoftware/stryker-js`)**
  _(session-settled: user-directed — chosen over maintaining separate CLI and Engine packages)_
  Merge `apps/stryker-js-cli` and `packages/stryker-js-engine` into `packages/stryker-js`. This unifies the CLI binary entrypoint and the execution engine into one package, matching the architecture of Vite and Vitest.
- **KTD2: Subpath Seam for Configuration (`./config`)**
  _(session-settled: user-directed — chosen over root export pollution)_
  Expose `defineConfig`, `mergeConfig`, and configuration types exclusively under `@systemfsoftware/stryker-js/config`. Keeps Node CLI process logic out of config files and provides clean IDE autocomplete.
- **KTD3: Wholesale Dismantling of `stryker-js-language` via Non-Breaking Shims**
  _(session-settled: user-directed — chosen over carving out config only and leaving the barrel alive)_
  Eliminate the 168-export barrel package. To prevent intermediate broken states where engine or instrumenter fail typecheck before consumer repointing completes:
  1. Relocate symbols to their vertical owners (`instrumenter`, `plugin-interface`, `stryker-js`).
  2. Have `stryker-js-language` temporarily re-export from the new owners as non-breaking forwarding shims.
  3. Batch-repoint all 104 workspace consumer files directly to the owners.
  4. Delete `stryker-js-language` whole.
- **KTD4: Built-in vs. Satellite Reporter Seam**
  _(session-settled: user-approved — chosen over either putting all reporters in satellites or merging HTML into core)_
  Terminal clear-text, progress bars, NDJSON stream, and JSON output live in `@systemfsoftware/stryker-js` as core facilities. HTML reporting remains in `@systemfsoftware/stryker-js-html-reporter` to keep heavy web component assets (`mutation-testing-elements`) optional.
- **KTD5: Refusal of Unearned Intermediary Packages**
  Reject the creation of `stryker-core`, `stryker-config`, or `stryker-metrics` packages. Per `package-earned-criterion.md`, capabilities without external peer dependencies or substrate contamination belong as subpath exports of the flagship tool.
- **KTD6: Built-in In-Memory `vm` Runner with Defect Semantics**
  _(session-settled: user-approved — chosen over creating a separate runner package)_
  Add `testRunner: 'vm'` directly into `@systemfsoftware/stryker-js` as a built-in runner alongside `testRunner: 'command'`. To eliminate manual build friction in `check:local` and `test/e2e`, Stryker performs a one-time in-memory type-strip on test files during the sandbox preparation stage, creating a warm `new vm.Script()`. The hot mutation testing loop reuses this script across all mutants in fresh microsecond V8 contexts, with `__stryker__` mutant state injected into the global object. This requires zero Node experimental flags and zero manual pre-bundling. Complex project test suites with deep Vite/Webpack module mocking continue to use the satellite `vitest-runner` in CI via `testRunner: isCi ? 'vitest' : 'vm'`. Dynamic import lives in `Layer.effect` via `Effect.promise(() => import('node:vm'))`. Per Scott Wlaschin's _Against Railway-Oriented Programming_, unrecoverable platform binding failures die as unhandled defects (`Cause.Die`).
- **KTD7: Monorepo Topology Alignment (`test/e2e`)**
  _(session-settled: user-approved — chosen over keeping apps/stryker-js-cli-e2e)_
  Relocate `apps/stryker-js-cli-e2e` to `test/e2e`. Aligns with Vite/Vitest convention where `test/` (singular) hosts standalone private test projects, while `tests/` (plural) is reserved for colocated tests inside individual packages.

### High-Level Technical Design

```
┌─────────────────────────────────────────────────────────────┐
│                 @systemfsoftware/stryker-js                 │
│                                                             │
│  bin: { "stryker": "./dist/main.mjs" }                      │
│  exports: {                                                 │
│    ".": "./dist/index.mjs",           (Pure Effect Cells)   │
│    "./config": "./dist/config.mjs",   (defineConfig/types)  │
│    "./promises": "./dist/promises.mjs"(Vanilla Promise API) │
│  }                                                          │
│                                                             │
│  ┌────────────────────────┐    ┌─────────────────────────┐  │
│  │     Config Engine      │    │    Core Execution       │  │
│  │ (defineConfig, Schema) │    │   (Run, Sandboxing)     │  │
│  └────────────────────────┘    └─────────────────────────┘  │
│  ┌────────────────────────┐    ┌─────────────────────────┐  │
│  │   Built-in Runners     │    │   Built-in Reporters    │  │
│  │    (command, vm)       │    │ (clear-text, json, ND)  │  │
│  └────────────────────────┘    └─────────────────────────┘  │
│  ┌────────────────────────┐                                 │
│  │   Metrics Calculation  │                                 │
│  │ (Scores, Thresholds)   │                                 │
│  └────────────────────────┘                                 │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│ stryker-js-instrumenter      │ │ stryker-js-plugin-interface│
│                              │ │                            │
│ - Mutant & MutantRunPlan     │ │ - TestRunner RPC schemas   │
│ - MutationRanges & Spans     │ │ - Checker RPC schemas      │
│ - AST Mutators & Transpiler  │ │ - Event streaming protocol │
└──────────────────────────────┘ └────────────────────────────┘
               ▲                              ▲
               │                              │
┌──────────────┴──────────────┐  ┌────────────┴───────────────┐
│ Ignorer Plugins             │  │ Out-of-Process Satellites  │
│ (@systemfsoftware/ignorer-*)│  │ (vitest-runner, checker-ts,│
│                             │  │  html-reporter)            │
└─────────────────────────────┘  └────────────────────────────┘
```

### Test Layer Admission & Placement (`skill://test-layer-selection`)

| Unit   | Scope / Component                               | Test Kind                  | Placement / Location                    | Why / Invariant                                                |
| ------ | ----------------------------------------------- | -------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| **U1** | `Mutant`, `MutantRunPlan` schemas               | Schema Law Property Tests  | Colocated `src/Mutant.schema.test.ts`   | Codec round-trip identity + encode stability                   |
| **U2** | Worker RPC schemas                              | Schema Law Property Tests  | Colocated `src/schema-laws.test.ts`     | RPC payload decode/encode contracts                            |
| **U3** | Unified `stryker-js` Engine Cells & `vm` runner | Sociable Integration Tests | Colocated `tests/*.integration.test.ts` | Verifies I/O sandwiches and in-memory VM runs in-process       |
| **U4** | `defineConfig`, `mergeConfig`                   | Pure Unit & Property Tests | Colocated `src/config/*.test.ts`        | Array concatenation, deep merge, and type preservation         |
| **U5** | Shipped CLI binary package                      | Sparse E2E Journey Tests   | `test/e2e` (2–4 journeys max)           | Seam-only: packed install closure, child worker RPC, exit code |

---

## Implementation Units

### U1: Relocate AST & Mutant Primitives to `stryker-js-instrumenter` with Forwarding Shims

- **Goal:** Move `Mutant.ts`, `Mutant.schema.ts`, `MutantRunPlan.ts`, `Location.ts`, `MutatorDescriptor.ts`, `MutationRange.ts`, `FileDescription`, `MutateDescription`, and `INSTRUMENTER_CONSTANTS` from `language` into `stryker-js-instrumenter`, leaving re-export shims in `language` so workspace dependencies remain green.
- **Requirements:** R7
- **Dependencies:** None
- **Files:**
  - `packages/stryker-js-instrumenter/src/Mutant.ts`
  - `packages/stryker-js-instrumenter/src/Mutant.schema.ts`
  - `packages/stryker-js-instrumenter/src/MutantRunPlan.ts`
  - `packages/stryker-js-instrumenter/src/Location.ts`
  - `packages/stryker-js-instrumenter/src/MutatorDescriptor.ts`
  - `packages/stryker-js-instrumenter/src/MutationRange.ts`
  - `packages/stryker-js-instrumenter/src/index.ts`
  - `packages/stryker-js-instrumenter/package.json`
  - `packages/stryker-js-language/src/Mutant.ts` (re-export shim)
- **Approach:**
  1. Transfer all AST and mutant models (`Mutant.ts`, `Mutant.schema.ts`, `MutantRunPlan.ts`, `Location.ts`, `MutatorDescriptor.ts`, `MutationRange.ts`, `FileDescription`, `MutateDescription`, `INSTRUMENTER_CONSTANTS`) into `packages/stryker-js-instrumenter/src/`.
  2. Export them directly from `packages/stryker-js-instrumenter/src/index.ts`.
  3. In `packages/stryker-js-language/src/Mutant.ts`, re-export all symbols from `@systemfsoftware/stryker-js-instrumenter`.
  4. Update `packages/stryker-js-instrumenter/package.json` to drop the `@systemfsoftware/stryker-js-language` dependency.
- **Test Scenarios:**
  - Schema law test: `MutantSchema` satisfies round-trip encoding and decoding laws (`src/Mutant.schema.test.ts`).
  - Instrumenter integration tests pass without importing `language`.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js-instrumenter test`

### U2: Relocate Worker RPC Protocols to `stryker-js-plugin-interface` with Forwarding Shims

- **Goal:** Move `TestRunner.ts`, `TestRunner.schema.ts`, `Checker.ts`, `Checker.schema.ts`, and `ExitClass.ts` into `stryker-js-plugin-interface`, leaving forwarding shims in `language`.
- **Requirements:** R8
- **Dependencies:** None
- **Files:**
  - `packages/stryker-js-plugin-interface/src/TestRunner.ts`
  - `packages/stryker-js-plugin-interface/src/TestRunner.schema.ts`
  - `packages/stryker-js-plugin-interface/src/Checker.ts`
  - `packages/stryker-js-plugin-interface/src/Checker.schema.ts`
  - `packages/stryker-js-plugin-interface/src/CheckResult.ts`
  - `packages/stryker-js-plugin-interface/src/DryRunResult.ts`
  - `packages/stryker-js-plugin-interface/src/ExitClass.ts`
  - `packages/stryker-js-plugin-interface/src/index.ts`
  - `packages/stryker-js-plugin-interface/package.json`
  - `packages/stryker-js-language/src/TestRunner.ts` (re-export shim)
  - `packages/stryker-js-language/src/Checker.ts` (re-export shim)
- **Approach:**
  1. Move runner and checker RPC schemas (`TestRunner`, `Checker`, `CheckResult`, `DryRunResult`, `ExitClass`) into `packages/stryker-js-plugin-interface/src/`.
  2. Re-export all worker schemas from `packages/stryker-js-plugin-interface/src/index.ts`.
  3. In `stryker-js-language`, turn `TestRunner.ts` and `Checker.ts` into forwarding re-exports pointing to `plugin-interface`.
  4. Drop `@systemfsoftware/stryker-js-language` dependency from `plugin-interface`.
- **Test Scenarios:**
  - Schema law test: RPC request/response schemas pass codec validation (`src/schema-laws.test.ts`).
  - Runner and checker plugins compile against `plugin-interface` without accessing `language`.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js-plugin-interface test`

### U3: Consolidate CLI and Engine into `@systemfsoftware/stryker-js` with Built-in `vm` Runner

- **Goal:** Clean out stale `packages/stryker-js`, implement the built-in `vm` runner, and merge `apps/stryker-js-cli` and `packages/stryker-js-engine` into `packages/stryker-js@5.0.0`.
- **Requirements:** R1, R5, R6
- **Dependencies:** U1, U2
- **Files:**
  - `packages/stryker-js/package.json`
  - `packages/stryker-js/tsdown.config.ts`
  - `packages/stryker-js/src/bin/main.ts`
  - `packages/stryker-js/src/index.ts`
  - `packages/stryker-js/src/promises/index.ts`
  - `packages/stryker-js/src/runners/VmRunner.ts`
  - `packages/stryker-js/src/runners/VmRunnerLive.ts`
  - `packages/stryker-js/src/reporters/` (clear-text, progress, progress-stream, json)
  - `packages/stryker-js/src/metrics/`
  - `apps/stryker-js-cli` (deleted)
  - `packages/stryker-js-engine` (deleted)
- **Approach:**
  1. Remove stale artifacts (`dist/`, old `.d.mts` files, and `etc/*.api.md` rolls) in `packages/stryker-js/` and initialize clean source tree.
  2. Implement `VmRunner` service tag and `VmRunnerLive` layer using `Effect.promise(() => import('node:vm'))`. Test files undergo a one-time in-memory type-strip during sandbox prep, followed by microsecond V8 script execution via `new vm.Script(code).runInContext(context)`.
  3. Wire built-in runner dispatch in `packages/stryker-js/src/runners/`: route `testRunner: 'command'` and `testRunner: 'vm'` directly in-process, reserving `WorkerLauncher` and RPC for satellite plugins (`vitest`, `jest`).
  4. Author pure Effect programmatic entrypoint `strykerCell` on `src/index.ts`, and author vanilla Promise wrapper `run()` in `src/promises/index.ts` backed by `NodeRuntime.runPromise`.
  5. Move `Metrics.ts`, `Report.schema.ts`, and `ReporterEvent.schema.ts` from `language` into `packages/stryker-js/src/metrics/`.
  6. Configure `package.json` with `"name": "@systemfsoftware/stryker-js"`, `"version": "5.0.0"`, `"bin": { "stryker": "./dist/main.mjs" }`, and library exports for `.`, `./config`, and `./promises`.
  7. Wire `tsdown.config.ts` with `dts: true` for library exports, wasm bundle defines, and bundling shims for the executable.
  8. Repoint internal engine references to import AST models from `instrumenter` and worker RPCs from `plugin-interface`.
  9. Delete `apps/stryker-js-cli` and `packages/stryker-js-engine`.
- **Test Scenarios:**
  - Sociable integration: `pnpm --filter @systemfsoftware/stryker-js test` runs the engine stage cells and reporter suites in-process.
  - VM runner unit test: Executes tests in-memory in <5ms without child process spawning.
  - Smoke boot: Executing `node ./packages/stryker-js/dist/main.mjs --help` outputs valid options and classes.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js test`

### U4: Implement `@systemfsoftware/stryker-js/config` Surface

- **Goal:** Author `defineConfig`, `ConfigEnv`, `mergeConfig`, and input type `StrykerConfig` under the `./config` subpath of `@systemfsoftware/stryker-js`.
- **Requirements:** R2, R3, R4
- **Dependencies:** U3
- **Files:**
  - `packages/stryker-js/src/config/defineConfig.ts`
  - `packages/stryker-js/src/config/mergeConfig.ts`
  - `packages/stryker-js/src/config/StrykerConfig.ts`
  - `packages/stryker-js/src/config/index.ts`
  - `packages/stryker-js/src/config.ts` (subpath entrypoint)
  - `packages/stryker-js/package.json`
- **Approach:**
  1. Author `defineConfig` as an identity function with overloads for `StrykerConfig`, `Promise<StrykerConfig>`, and `(env: ConfigEnv) => StrykerConfig | Promise<StrykerConfig>`. Define `ConfigEnv` carrying `{ command: 'run' | 'merge-reports', isDryRun: boolean, mode: OutputMode, isCi: boolean }`.
  2. Implement `mergeConfig` with array concatenation for `plugins` and `reporters`, and deep merging for option objects.
  3. Define `StrykerConfig` as a proper deep-optional input type supporting unions and nested objects.
  4. Expose `./config` in `package.json` `exports` and `publishConfig.exports` with `@systemfsoftware/source` pointing to `./src/config.ts`, `types` to `./dist/config.d.mts`, and `default` to `./dist/config.mjs`.
  5. Update the config loader bootstrap sequence: parse CLI command line arguments to resolve `command` and detect output mode (`OutputModeProbe`), then invoke function-form configurations `({ command, mode, isCi })` before executing schema validation.
- **Test Scenarios:**
  - Pure unit test: `defineConfig` returns input unchanged and typechecks with partial configurations.
  - Pure unit test: `mergeConfig` concatenates arrays without deduplicating custom entries, while deep-merging option objects.
  - Config loader test: Config file exporting a function `({ command }) => ({ ... })` evaluates and runs cleanly.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js test`

### U5: Relocate E2E Testbed to `test/e2e`, Repoint All Consumers, and Delete `stryker-js-language`

- **Goal:** Move `apps/stryker-js-cli-e2e` to `test/e2e`, update all 104 consumer files and E2E fixtures to import from domain packages (`instrumenter`, `plugin-interface`, `stryker-js`), and delete `packages/stryker-js-language`.
- **Requirements:** R9, R10
- **Dependencies:** U1, U2, U3, U4
- **Files:**
  - `test/e2e/` (moved from `apps/stryker-js-cli-e2e`)
  - `test/e2e/package.json`
  - `test/e2e/tests/__fixtures__/bed.ts`
  - `packages/stryker-js-language/` (deleted whole)
  - `pnpm-workspace.yaml`
  - All importing files across `packages/`
- **Approach:**
  1. Move `apps/stryker-js-cli-e2e` to `test/e2e` and rename its package to `@systemfsoftware/stryker-e2e`. Update `apps/AGENTS.md` and `.github/workflows/ci.yml` paths accordingly.
  2. Update `pnpm-workspace.yaml` to include `'test/*'` and remove `apps/*`.
  3. Repoint `test/e2e` bed to pack and install `@systemfsoftware/stryker-js`.
  4. Repoint all import statements across all workspace satellite packages (`vitest-runner`, `typescript-checker`, `html-reporter`, `plugin-runtime`, `test-contribution`) from `@systemfsoftware/stryker-js-language` to their new owners (`stryker-js`, `stryker-js-instrumenter`, `stryker-js-plugin-interface`).
  5. Delete `packages/stryker-js-language` directory and clean up stale `etc/*.api.md` rolls.
  6. Run workspace typecheck and tests to confirm clean removal.
- **Test Scenarios:**
  - Workspace search: `git grep '@systemfsoftware/stryker-js-language'` returns zero matches.
  - E2E lane in `test/e2e` installs the packed `@systemfsoftware/stryker-js` tarball and runs container journeys.
- **Verification:** `pnpm typecheck && pnpm test && pnpm --filter @systemfsoftware/stryker-e2e test`

---

## Verification Contract

- **`START-1`**: Code formatting matches dprint (`pnpm format:check`).
- **`START-2`**: Workspace typecheck passes (`pnpm typecheck`).
- **`START-3`**: All test suites pass across all packages (`pnpm test`).
- **`START-4`**: Workspace build and verification tasks pass (`pnpm check:ci`).
- **`START-5`**: Package changes include change intent (`./scripts/check-changeset.ts $(git merge-base HEAD origin/main)`).
- **`E2E-SEAM`**: Sparse container E2E lane passes with ≤4 seam-only journeys (`pnpm --filter @systemfsoftware/stryker-e2e test`).

---

## Definition of Done

1. `@systemfsoftware/stryker-js@5.0.0` is built, tested, and published as the single flagship package providing the `stryker` executable, built-in runners (`command`, `vm`), and `./config` subpath.
2. `packages/stryker-js-language`, `packages/stryker-js-engine`, and `apps/stryker-js-cli` are completely removed from the filesystem and workspace.
3. The container-backed E2E test harness is cleanly located at `test/e2e`.
4. No residual import references to `stryker-js-language` or `stryker-js-engine` exist in code or package manifests.
5. All 6 gates in the Verification Contract (`START-1` to `START-5` and `E2E-SEAM`) pass cleanly.
6. All abandoned intermediate files or dead code branches are removed from the working tree.
