---
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
title: VM Harness Package & Pure Cell Refactor - Plan
type: refactor
date: 2026-09-21
---

# VM Harness Package & Pure Cell Refactor - Plan

## Goal Capsule

Extract the in-memory VM test-runner harness from `@systemfsoftware/stryker-js` into a dedicated workspace package (`@systemfsoftware/stryker-vm-harness`), and restructure its state management and execution pipelines to adhere religiously to `@systemfsoftware/effect-cell-types` (`Cell`, `Sandwich`, `Workflow`) and the repo's Pure Core / Imperative Shell constitutional architecture (CONST-P1, CONST-P2, CONST-B3).

- **Objective**: The VM harness is an independently publishable, strictly-typed package whose pure decision core is single-path (cyclomatic complexity 1) and whose impure shell is a thin `read -> transform -> write` sandwich.
- **Means**: Extract `packages/stryker-js/src/vm-harness/*` into `packages/stryker-vm-harness/`, wrapping registry, drain, interception, and global-state in typed `Workflow`/`Sandwich` cells; `VmRunner.ts` in `packages/stryker-js` consumes the new package as a workspace dependency.
- **Authority hierarchy**: `CONSTITUTION.md` > `AGENTS.md` > plan Product Contract > Implementation Units > code.
- **Stop conditions**: All unit tests, integration tests, and container e2e tests pass; `@systemfsoftware/oxlint-plugin-effect-dmmf` reports zero violations; no new suppression comments.
- **Execution profile**: Standard refactor, 4–6 units, ordered by dependency.
- **Who finishes and ships**: `ce-work` with subagent-driven development, simplification, code review, and commits.

---

## Product Contract

### Summary

The current VM harness lives inside `packages/stryker-js/src/vm-harness/` as a set of loosely-coupled modules with mutable global state, procedural registry manipulation, and ad-hoc effect management. This plan extracts it into a standalone `@systemfsoftware/stryker-vm-harness` package and restructures it to follow the Effect DMMF (Domain Model, Model, Function) and `@systemfsoftware/effect-cell-types` patterns already established in sibling packages (`stryker-js-vitest-runner`, `stryker-js-typescript-checker`).

### Problem Frame

The VM harness is the only first-party runner component that is not a standalone workspace package, and it is the only one that does not use `Cell`, `Sandwich`, or `Workflow` for its execution pipelines. Its mutable global-state cell, procedural `drainRegistry` executor, and imperative `interception.ts` sandbox stack make it hard to reason about, test, and reuse outside the Stryker CLI.

### Requirements

**Package extraction**

- R1. `packages/stryker-vm-harness` is added to `pnpm-workspace.yaml` and builds cleanly with `tsdown`, `attw`, and `api:check`.
- R2. `packages/stryker-vm-harness/package.json` mirrors `packages/stryker-js-vitest-runner/package.json`: `@systemfsoftware/effect-cell-types` as a `catalog:` dependency, `effect` and `vitest` as peer dependencies (`catalog:`/range), and `@effect/vitest` plus `@effect/platform-node` as `catalog:` devDependencies.
- R3. `packages/stryker-js` consumes `@systemfsoftware/stryker-vm-harness` as a `workspace:^` dependency and no longer ships `src/vm-harness/`.

**Pure cell architecture**

- R4. Every public API in `packages/stryker-vm-harness` is expressed as a pure `Workflow`, `Sandwich`, or `Cell` from `@systemfsoftware/effect-cell-types`, with no direct `Effect.runPromise`, `Effect.runSync`, or mutable global state outside typed cells. Typed `Cell`/`Sandwich` pipelines own their internal interpretation edge; as a rootless package its `interpreted` edge is occupied only externally, by the consuming process (`VmRunner` composes the exported values with `yield*`, observable behavior unchanged — R3, R7).
- R5. The pure decision core (test planning, test drainage, per-test status mapping) has cyclomatic complexity 1 and passes `@systemfsoftware/oxlint-plugin-effect-dmmf` with zero violations; mutant-result interpretation stays in `packages/stryker-js` (Scope Boundaries).
- R6. The imperative shell (module interception, sandbox activation, native import, hook registration) is a thin `read -> transform -> write` sandwich with no decisions and no interleaved I/O.

**Behavior preservation**

- R7. All existing integration tests (`packages/stryker-js/tests/vm-runner.integration.test.ts`), unit tests, and container e2e tests (`test/e2e/tests/typescript-checker.e2e.test.ts`, `test/e2e/tests/vm-vitest.e2e.test.ts`) pass unchanged.
- R8. Mutation score on `packages/stryker-js` does not regress relative to the current branch baseline.

### Success Criteria

- `pnpm check:ci` passes for the whole workspace.
- `pnpm --filter @systemfsoftware/stryker-vm-harness test` passes.
- `pnpm --filter @systemfsoftware/stryker-js test` passes.
- `pnpm --filter @systemfsoftware/stryker-js mutation` runs without new surviving mutants in `VmRunner.ts` or the extracted harness.
- CI green: `check (ubuntu-latest)`, `check (macos-latest)`, `e2e`, `Mutation`, `Changeset Check`, `Commitlint`.

### Scope Boundaries

**Deferred for later**

- Refactoring `stryker-js-vitest-runner` or `stryker-js-typescript-checker` to share common harness primitives beyond the new package.
- Moving `VmRunner.ts` orchestration into `packages/stryker-vm-harness` (the runner shell stays in `packages/stryker-js`).

**Outside this product's identity**

- Changing the Vitest, `@effect/vitest`, or Gherkin API surface the harness supports.
- Supporting Jest, Mocha, or other test frameworks in the VM harness.

### Key Decisions

- **KD1.** Extract into a dedicated workspace package rather than refactor in-place. Rationale: the harness is reusable outside the Stryker CLI and needs its own publishable API surface, mutation cell, and test contract. Governs R1, R2, R3.
- **KD2.** Strictly adopt `@systemfsoftware/effect-cell-types` (`Cell`, `Sandwich`, `Workflow`) rather than raw `Effect.gen` + mutable state. Rationale: matches sibling packages, enforces pure-core/imperative-shell separation, and satisfies CONST-P1/P2/B3. Governs R4, R5, R6.

### Outstanding Questions

None. All product decisions are settled in the brainstorm and this plan.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Package boundary.** Create `packages/stryker-vm-harness/` as a sibling to `packages/stryker-js/`, not a sub-package. Rationale: matches the existing monorepo layout (`packages/stryker-js-*`, `packages/ignorers/*`) and keeps the harness independently versioned and publishable. Cites R1, R2.
- KTD2. **Pure core files.** The pure decision core lives in `packages/stryker-vm-harness/src/core/` (registry planning, drain interpretation, status mapping) and has cyclomatic complexity 1. Rationale: CONST-P2 and `@systemfsoftware/oxlint-plugin-effect-dmmf` enforce this. Cites R5.
- KTD3. **Imperative shell files.** The impure shell lives in `packages/stryker-vm-harness/src/shell/` (module interception, sandbox activation, native import, global-state cell) and is expressed as `Sandwich`/`Cell` pipelines with no decisions. Rationale: CONST-B3 and CONST-P1. Cites R4, R6.
- KTD4. **Public API surface.** The package exports only typed services and pure workflows from `src/index.ts`; internal shell/core modules are not re-exported. Rationale: prevents consumers from coupling to implementation details. Cites R3.
- KTD5. **Test strategy.** Pure core is tested with property-based tests (`fast-check`) and mutation tests; shell is tested with integration tests using the real VM. Rationale: matches sibling packages (`stryker-js-instrumenter`, `stryker-js-vitest-runner`). Cites R7, R8.

### Assumptions

- The current `vm-harness` code compiles and passes all existing tests on this branch.
- `@systemfsoftware/effect-cell-types` `^8.3.1` provides the required `Cell`, `Sandwich`, and `Workflow` primitives.
- No changes to `packages/stryker-js/src/VmRunner.ts` semantics are required beyond replacing `vm-harness` imports with `@systemfsoftware/stryker-vm-harness` imports.

### Sequencing

1. Scaffold `packages/stryker-vm-harness/` with build, test, and lint configuration.
2. Extract pure core (registry, drain, each-name, sources, guards) into `packages/stryker-vm-harness/src/core/`.
3. Extract imperative shell (interception, global-state, effect-adapter) into `packages/stryker-vm-harness/src/shell/`.
4. Wrap core and shell in `Workflow`/`Sandwich` cells and expose public API in `src/index.ts`.
5. Update `packages/stryker-js/src/VmRunner.ts` to consume the new package and delete `packages/stryker-js/src/vm-harness/`.
6. Run full verification and mutation dogfood.

---

## Implementation Units

### U1. Scaffold `@systemfsoftware/stryker-vm-harness` package

**Goal:** Create a buildable, lintable, testable workspace package with the standard monorepo toolchain.

**Requirements:** R1, R2

**Dependencies:** none

**Files:**

- `packages/stryker-vm-harness/package.json`
- `packages/stryker-vm-harness/tsconfig.json`
- `packages/stryker-vm-harness/tsconfig.node.json`
- `packages/stryker-vm-harness/tsdown.config.ts`
- `packages/stryker-vm-harness/vitest.config.ts`
- `packages/stryker-vm-harness/oxlint.config.ts`
- `packages/stryker-vm-harness/stryker.config.ts`
- `packages/stryker-vm-harness/api-extractor.json`
- `packages/stryker-vm-harness/etc/stryker-vm-harness.api.md`
- `packages/stryker-vm-harness/README.md`
- `pnpm-workspace.yaml` (add `packages/stryker-vm-harness` to packages and `@systemfsoftware/stryker-vm-harness: latest` to `catalogs.stryker` per AGENTS.md START-6)

**Approach:**

1. Copy the package scaffold from `packages/stryker-js-vitest-runner/` (same `catalog:` dependency shape, `tsdown` config, `oxlint` strict trio, `attw` script).
2. Set `name: "@systemfsoftware/stryker-vm-harness"`, `version: "1.0.0"`, `type: "module"`.
3. Declare dependencies mirroring `packages/stryker-js-vitest-runner/package.json`: `@systemfsoftware/effect-cell-types` `catalog:` in `dependencies`; `effect` `catalog:` and `vitest` in `peerDependencies`; `@effect/vitest`, `@effect/platform-node`, `@microsoft/api-extractor` `catalog:` in `devDependencies`. For its own mutation dogfood (AGENTS.md START-6: mutation runs the published CLI), declare `@systemfsoftware/stryker-js`, `@systemfsoftware/stryker-js-vitest-runner`, `@systemfsoftware/stryker-js-typescript-checker`, `@systemfsoftware/stryker-ignorer-effect-schema-declarations`, `@systemfsoftware/stryker-ignorer-in-source-vitest-block`, and `@systemfsoftware/stryker-test-contribution` as `catalog:stryker` devDependencies, and add a `stryker.config.ts` mirroring `packages/stryker-js-vitest-runner/stryker.config.ts`.
4. Add `packages/stryker-vm-harness` to `pnpm-workspace.yaml` packages list and `@systemfsoftware/stryker-vm-harness: latest` to its `catalogs.stryker` block.
5. Run `pnpm install` to update the lockfile.

**Patterns to follow:** `packages/stryker-js-vitest-runner/package.json`, `packages/stryker-js-typescript-checker/package.json`.

**Test scenarios:**

- `pnpm --filter @systemfsoftware/stryker-vm-harness build` exits 0.
- `pnpm --filter @systemfsoftware/stryker-vm-harness lint` exits 0.
- `pnpm --filter @systemfsoftware/stryker-vm-harness typecheck` exits 0.

**Verification:** `pnpm install --frozen-lockfile` and `pnpm --filter @systemfsoftware/stryker-vm-harness build` succeed on a fresh clone.

### U2. Extract pure core into `packages/stryker-vm-harness/src/core/`

**Goal:** Move the pure, decision-heavy modules from `packages/stryker-js/src/vm-harness/` into the new package's pure core with single-path cyclomatic complexity.

**Requirements:** R4, R5

**Dependencies:** U1

**Files:**

- `packages/stryker-vm-harness/src/core/registry.ts`
- `packages/stryker-vm-harness/src/core/drain.ts`
- `packages/stryker-vm-harness/src/core/each-name.ts`
- `packages/stryker-vm-harness/src/core/sources.ts`
- `packages/stryker-vm-harness/src/core/guards.ts`
- `packages/stryker-vm-harness/src/core/index.ts`
- `packages/stryker-vm-harness/src/core/registry.property.test.ts`
- `packages/stryker-vm-harness/src/core/drain.property.test.ts`
- `packages/stryker-vm-harness/src/core/each-name.test.ts`
- `packages/stryker-vm-harness/src/core/guards.test.ts`

**Approach:**

1. Copy `packages/stryker-js/src/vm-harness/registry.ts` to `packages/stryker-vm-harness/src/core/registry.ts`.
2. Refactor `createRegistry`, `createHarnessApi`, `createIt`, `createDescribe`, and `planRun` to use `@systemfsoftware/effect-cell-types` `Workflow` and `Sandwich` instead of closing over mutable Maps and arrays.
3. Copy `packages/stryker-js/src/vm-harness/drain.ts` to `packages/stryker-vm-harness/src/core/drain.ts`; refactor `drainRegistry` to a pure `Workflow` that interprets a registry into `DrainedTest[]` and `DrainOutcome`, with all I/O moved to the shell.
4. Copy `each-name.ts`, `sources.ts`, and `guards.ts` verbatim; they are already pure.
5. Add property-based tests for `planRun`, `drainRegistry`, and `formatEachName` using `fast-check` and `@effect/vitest`.
6. Export the pure core from `src/core/index.ts`.

**Execution note:** Implement the refactored workflows test-first: start with a failing property test for `planRun` on a generated registry, then refactor until green.

**Patterns to follow:** `packages/stryker-js-vitest-runner/src/interpret-vitest-run.workflow.ts`, `packages/stryker-js-typescript-checker/src/check-mutants.workflow.ts`.

**Test scenarios:**

- Property test: `planRun` on a generated registry with random only/skip flags returns a deterministic `ReadonlyArray<PlannedTest>` (happy path + edge cases).
- Property test: `drainRegistry` on a generated registry with random test outcomes returns the correct `DrainOutcome` (happy path, error paths, timeout paths).
- Unit test: `formatEachName` handles `%i`, `%d`, `%j`, `%#`, and `$var` placeholders correctly (happy path, edge cases).
- Unit test: `guardedExpect` and `guardedVi` reject snapshot and module-mock calls (error paths).

**Verification:** `pnpm --filter @systemfsoftware/stryker-vm-harness test` and `pnpm --filter @systemfsoftware/stryker-vm-harness mutation` pass with 100% kill on the pure core.

### U3. Extract imperative shell into `packages/stryker-vm-harness/src/shell/`

**Goal:** Move the impure, I/O-heavy modules from `packages/stryker-js/src/vm-harness/` into the new package's shell as thin `Sandwich`/`Cell` pipelines.

**Requirements:** R4, R6

**Dependencies:** U1, U2

**Files:**

- `packages/stryker-vm-harness/src/shell/interception.ts`
- `packages/stryker-vm-harness/src/shell/global-state.ts`
- `packages/stryker-vm-harness/src/shell/native-import.ts`
- `packages/stryker-vm-harness/src/shell/effect-adapter.ts`
- `packages/stryker-vm-harness/src/shell/index.ts`
- `packages/stryker-vm-harness/src/shell/interception.integration.test.ts`

**Approach:**

1. Copy `packages/stryker-js/src/vm-harness/interception.ts` to `packages/stryker-vm-harness/src/shell/interception.ts`.
2. Refactor `installInterception`, `uninstallInterception`, `activateSandbox`, and `deactivateSandbox` to use `@systemfsoftware/effect-cell-types` `Cell` and `Sandwich` instead of mutable global flags and stack pushes.
3. Copy `packages/stryker-js/src/vm-harness/global-state.ts` to `packages/stryker-vm-harness/src/shell/global-state.ts`; refactor `readGlobalState`/`writeGlobalState` into a typed `Cell` while preserving `STATE_KEY = Symbol.for('@systemfsoftware/stryker-js/vm-runner')` unchanged — the symbol's description string is the cross-package seam the `vm-runner.integration.test.ts` suite fixtures look up (R7).
4. Copy `packages/stryker-js/src/vm-harness/effect-adapter.ts` to `packages/stryker-vm-harness/src/shell/effect-adapter.ts`; refactor `makeEffectMethods` and `layerBinderFor` to use `Cell.provide` and `Sandwich.read` instead of `Effect.runPromise` and unsafe `Scope`/`Layer` calls.
5. Move `nativeImport` out of `packages/stryker-js/src/VmRunner.ts` into `packages/stryker-vm-harness/src/shell/native-import.ts` and export it — R6 names native import as a shell concern, and the U3 integration scenarios drive it.
6. Export the shell from `src/shell/index.ts`.
7. Add integration tests that exercise `installInterception` + `activateSandbox` + `nativeImport` in a real VM.

**Patterns to follow:** `packages/stryker-js-vitest-runner/src/Runner.ts` (the `Sandwich.read` usage for `mutantRunCell`), `packages/stryker-js-typescript-checker/src/Checker.ts` (the `Cell.provide` usage for `checkCell`).

**Test scenarios:**

- Integration test: `installInterception` + `activateSandbox` + `nativeImport` of a salted URL loads the harness and registers suites (happy path).
- Integration test: `deactivateSandbox` + `uninstallInterception` cleans up the sandbox stack and global state (edge cases).
- Integration test: concurrent `activateSandbox` calls are serialized by the shell's `Cell` semaphore (error paths).
- Integration test: `makeEffectMethods` runs an Effect test with a real `Layer` and returns the correct result (happy path, error paths).

**Verification:** `pnpm --filter @systemfsoftware/stryker-vm-harness test` passes and `pnpm --filter @systemfsoftware/stryker-vm-harness lint` reports zero `@systemfsoftware/oxlint-plugin-effect-dmmf` violations.

### U4. Wire public API and update `packages/stryker-js`

**Goal:** Export a clean public API from `packages/stryker-vm-harness` and make `packages/stryker-js` consume it.

**Requirements:** R3, R7

**Dependencies:** U2, U3

**Files:**

- `packages/stryker-vm-harness/src/index.ts`
- `packages/stryker-js/package.json` (add `@systemfsoftware/stryker-vm-harness` `workspace:^`)
- `packages/stryker-js/src/VmRunner.ts`
- `packages/stryker-js/src/vm-harness/` (delete)

**Approach:**

1. Create `packages/stryker-vm-harness/src/index.ts` exporting only the typed services and pure workflows needed by `VmRunner.ts`: `createRegistry`, `createHarnessApi`, `drainRegistry`, `installInterception`, `uninstallInterception`, `activateSandbox`, `deactivateSandbox`, `readGlobalState`, `writeGlobalState`, `makeEffectMethods`, `guardedExpect`, `guardedVi`, `harnessUrlForSpecifier`, `harnessSourceFor`, `formatEachName`, `nativeImport`, plus the types `HarnessModuleBuiltin` and `VmRunnerGlobalState`.
2. Update `packages/stryker-js/package.json` to add `@systemfsoftware/stryker-vm-harness: workspace:^` to `dependencies`.
3. Update `packages/stryker-js/src/VmRunner.ts` to import from `@systemfsoftware/stryker-vm-harness` instead of `./vm-harness/*.js`.
4. Delete `packages/stryker-js/src/vm-harness/`.
5. Verify `packages/stryker-js/src/index.ts` still re-exports `VmRunner` and `vmTestRunner` (they are already exported there; no change expected).

**Patterns to follow:** `packages/stryker-js/src/index.ts` (re-export pattern), `packages/stryker-js-vitest-runner/src/index.ts` (public API shape).

**Test scenarios:**

- `pnpm --filter @systemfsoftware/stryker-js build` exits 0.
- `pnpm --filter @systemfsoftware/stryker-js test` passes (`tests/vm-runner.integration.test.ts`).
- `pnpm --filter @systemfsoftware/stryker-js lint` exits 0.
- `pnpm --filter @systemfsoftware/stryker-js typecheck` exits 0.

**Verification:** `pnpm check:ci` passes for the whole workspace.

### U5. Container e2e and mutation dogfood

**Goal:** Prove the extracted package works end-to-end in the container and does not regress mutation score.

**Requirements:** R7, R8

**Dependencies:** U4

**Files:**

- `test/e2e/testResources/typescript-checker-fixture/src/order.vm.test.ts` (already migrated)
- `test/e2e/tests/typescript-checker.e2e.test.ts`
- `test/e2e/tests/vm-vitest.e2e.test.ts`
- `.changeset/stryker-vm-harness-package.md`

**Approach:**

1. Run `pnpm --filter @systemfsoftware/stryker-e2e test` to verify `typescript-checker.e2e.test.ts` and `vm-vitest.e2e.test.ts` pass in the `node:24-alpine` container.
2. Run `pnpm --filter @systemfsoftware/stryker-js mutation` and compare the mutation report to the current branch baseline; investigate any new surviving mutants in `VmRunner.ts` or the extracted harness.
3. Write a changeset (`minor` for `@systemfsoftware/stryker-vm-harness`, `patch` for `@systemfsoftware/stryker-js`) describing the extraction and refactor.
4. Update `packages/stryker-js/README.md` to mention `@systemfsoftware/stryker-vm-harness` as a sibling package.

**Test scenarios:**

- Container e2e: `typescript-checker.e2e.test.ts` exits 0 with verdict `compileErrors: 4, killed: 2, survived: 1`.
- Container e2e: `vm-vitest.e2e.test.ts` exits 0 with verdict `killed: 7, survived: 2`.
- Mutation: `pnpm --filter @systemfsoftware/stryker-js mutation` produces no new surviving mutants compared to the baseline.

**Verification:** CI green: `check (ubuntu-latest)`, `check (macos-latest)`, `e2e`, `Mutation`, `Changeset Check`, `Commitlint`.

---

## Verification Contract

| Gate              | Command                                                                                             | Signal                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Workspace install | `pnpm install --frozen-lockfile`                                                                    | exit 0                                                               |
| Build             | `pnpm build`                                                                                        | exit 0                                                               |
| Typecheck         | `pnpm typecheck`                                                                                    | exit 0                                                               |
| Lint              | `pnpm lint`                                                                                         | exit 0, zero `@systemfsoftware/oxlint-plugin-effect-dmmf` violations |
| Unit tests        | `pnpm test`                                                                                         | exit 0                                                               |
| Integration tests | `pnpm --filter @systemfsoftware/stryker-js test`                                                    | exit 0                                                               |
| Container e2e     | `pnpm --filter @systemfsoftware/stryker-e2e test`                                                   | exit 0                                                               |
| Mutation          | `pnpm --filter @systemfsoftware/stryker-js mutation`                                                | no new surviving mutants                                             |
| CI                | `check (ubuntu-latest)`, `check (macos-latest)`, `e2e`, `Mutation`, `Changeset Check`, `Commitlint` | all green                                                            |
| Changeset         | `./scripts/check-changeset.ts $(git merge-base HEAD origin/main)`                                   | exit 0                                                               |

---

## Definition of Done

- All Implementation Units are committed to the `v8-vm` branch.
- `pnpm check:ci` passes on a fresh clone.
- `pnpm --filter @systemfsoftware/stryker-js mutation` shows no new surviving mutants in `VmRunner.ts` or the extracted harness.
- All container e2e tests pass in `node:24-alpine`.
- CI green on the final head commit.
- No dead-end or experimental code remains in the diff.
