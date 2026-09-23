---
title: Vitest Compatibility in Stryker V8 Runner
created_at: 2026-09-21-0025
updated_at: 2026-09-23-2040
type: feat
topic: v8-vm-vitest-runner-compatibility
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

## Goal Capsule

- **Objective:** Pure unit, property, and Gherkin effect test suites written for Vitest execute out of the box under Stryker's in-memory V8 runner (`testRunner: 'vm'`) without spawning child processes.
- **Means:** Intercept `vitest`/`@effect/vitest`/`@systemfsoftware/effect-gherkin-spec` imports from sandbox test files via `module.registerHooks()` hooks; re-export the real `expect`/`vi` from the user's installed Vitest; own only the registration layer; re-import the sandbox graph per run under salted URLs (KD2, KTD1–KTD3).
- **Product Authority:** The V8 runner serves in-memory mutation runs for engine-compatible tests; tests requiring browser DOM, snapshot state, or hoisted module mocking route to `testRunner: 'vitest'`.
- **Open Blockers:** None.

---

## Product Contract

### Summary

An in-memory Vitest harness inside Stryker's V8 runner (`testRunner: 'vm'`). Test files importing `vitest`, `@effect/vitest`, and `@systemfsoftware/effect-gherkin-spec` run directly in-process: real matcher and mocking implementations from the installed Vitest, a first-party registration layer, and per-test reporting.

### Problem Frame

Stryker's V8 runner compiles all test files into a single Node VM script that expects tests to throw on error, collapsing the entire execution into one monolithic test outcome (`id: 'all'`). Standard suites across the ecosystem and `systemfsoftware` repositories use Vitest syntax (`describe`, `it`, `expect`, `it.effect`, `it.prop`, `makeFeature`). Teams are forced onto the heavier out-of-process `vitest` runner even for pure, engine-compatible tests that could run orders of magnitude faster in-memory.

### Key Decisions

- **KD1. In-memory harness over full Vitest engine embed**: No Vite dev-server, no worker processes, no plugin pipeline; in-process execution keeps per-test overhead near module-evaluation cost. Governs R1, R2, R4.
  (session-settled: user-directed — chosen over embedded vitest runner: user required out-of-the-box support for existing test suites without process spawning overhead)
- **KD2. Runtime interception with real-runtime composition**: Import interception scoped to sandbox test files, with the real installed Vitest supplying assertions and mocking and a first-party registration layer owning test collection. Governs R3, R5, R6.
  (session-settled: user-directed — mechanism delegated by the user after in-session spike refuted the bundle-plus-real-collector alternative: vitest 5 is ESM-only and its collector internals are worker-coupled, so bundling cannot load it and third parties cannot drive it; interception plus real `expect`/`vi` re-export delivers the same out-of-the-box goal without a bundler dependency)
- **KD3. Granular per-test outcome reporting with async drain**: Await the registered test functions with timeout and map outcomes to individual `TestResult` records with IDs, suite-hierarchy names, durations, and failure messages. Governs R9.
- **KD4. Effect execution through a first-party adapter mirroring `@effect/vitest`**: Effect suites run through an adapter that reproduces `it.effect`/`it.scoped`/`it.live`/`it.layer`/`it.prop` registration semantics (run-loop, Layer provisioning, `Cause` formatting) against the harness registry. Governs R7, R8.
- **KD5. Node 24 as the forward floor**: Raise the engine requirement to modern Node rather than carrying 22.x compatibility paths. Governs R10.
  (session-settled: user-directed — chosen over keeping the 22.18 floor: be forward-looking; `registerHooks` reaches release-candidate stability on 24.13.1)

### Requirements

#### Vitest Test Suite Execution

- R1. The V8 runner must provide standard test declaration functions (`describe`, `suite`, `it`, `test`) supporting nested suites, `.skip`, `.only`, `.todo`, and `.each`.
- R2. The V8 runner must support asynchronous test functions and promise returning assertions, awaiting asynchronous completion before evaluating status.
- R3. The V8 runner must load test files that import from `'vitest'` unmodified, intercepting only the registration surface; assertions and mocks come from the user's real installed Vitest.
- R4. The V8 runner must implement standard Vitest lifecycle hooks (`beforeAll`, `beforeEach`, `afterEach`, `afterAll`, `onTestFinished`) executed in their proper hierarchical order.

#### Assertion and Mocking Surface

- R5. Assertions and mocking behavior must match the installed Vitest version's real `expect` and `vi` implementations, including matchers, `.not`, promise modifiers, and asymmetric matchers.
- R6. Basic mocking (`vi.fn()`, `vi.spyOn()`, `vi.clearAllMocks()`) must work for pure unit tests through the real `vi` implementation.

#### Effect and Gherkin Integration

- R7. The V8 runner must execute `@effect/vitest` test suites (`it.effect`, `it.scoped`, `it.prop`, `it.live`, `it.layer`) with Effect run-loops, Layer provisioning, property loops, and fiber error extraction working as published.
- R8. The V8 runner must execute `@systemfsoftware/effect-gherkin-spec` features (`makeFeature`, `Given`, `When`, `Then`, scenario outlines) resolving steps within the run.

#### Test Reporting Contract

- R9. Test runs must yield `DryRunResult` and `MutantRunResult` containing individual test entries with unique IDs, names matching their suite hierarchy, individual run times, and extracted failure messages.

#### Packaging

- R10. The package's Node engine requirement rises to `>=24.13.1`; no 22.x/23.x support is retained.

### Scope Boundaries

#### In Scope

- Pure JavaScript and TypeScript test files using standard Vitest APIs.
- Suites utilizing `@effect/vitest` and `@systemfsoftware/effect-gherkin-spec`.
- Per-test failure reporting and duration tracking.

#### Deferred for Later

- Snapshot testing assertions (`toMatchSnapshot`, `toMatchInlineSnapshot`) — explicitly unsupported in v1; calls fail fast with an explanatory error to prevent silent mutant survival.
- Advanced Vitest mock timers and module mocking (`vi.mock()`) — explicitly unsupported in v1; tests requiring hoisted module mocking route to the Vitest process runner.

#### Outside Scope

- Browser DOM / happy-dom / jsdom environments.
- Execution requiring external Vite plugins or custom rollup build steps.

### Acceptance Examples

- AE1. Standard Vitest Spec
  - **Covers:** R1, R2, R3, R5, R6, R9
  - **Given:** A test file importing `{ describe, it, expect, vi }` from `'vitest'` with two passing tests, one failing async test, hook ordering, and a `vi.fn()` assertion.
  - **When:** Stryker runs `testRunner: 'vm'` on the file.
  - **Then:** Tests execute independently — distinct per-test records, hooks observed in hierarchy order, failing async test recorded with the real matcher's failure text, `vi.fn()` behavior from the real implementation.

- AE2. Effect-Vitest Property & Effect Tests
  - **Covers:** R7, R9
  - **Given:** A test file importing `{ describe, it }` from `'@effect/vitest'` executing `it.effect` and `it.prop`.
  - **When:** Stryker runs the V8 runner against a mutant that breaks an Effect assertion.
  - **Then:** The specific failing test is recorded as `failed` with the formatted Effect cause in `failureMessage`, killing the mutant.

- AE3. Effect Gherkin Feature Spec
  - **Covers:** R8, R9
  - **Given:** A test file using `makeFeature` from `@systemfsoftware/effect-gherkin-spec` with scenario steps.
  - **When:** Stryker executes the suite in the V8 runner.
  - **Then:** All scenarios execute and report their individual scenario outcomes.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **`module.registerHooks()` interception scoped to sandbox-origin imports.** Synchronous, main-thread resolve/load hooks redirect `vitest`, `@effect/vitest`, and `@systemfsoftware/effect-gherkin-spec` to first-party harness modules only when the importing module lives under the sandbox directory; every other import path (including Stryker's own code and other runners) is untouched. Bare imports issued by harness modules themselves re-base onto the sandbox URL so the user's real packages resolve. `registerHooks` is release-candidate stable from Node v24.13.1 and its return handle supports deregistration; `module.register()` is doc-deprecated in its favor (nodejs/node#62395). Governs R3; instantiates KD2.
- KTD2. **Real-runtime composition: import what is public, own only registration.** The `vitest` harness re-exports the installed Vitest's real `expect`, `vi`, and `assert` and provides first-party `describe`/`it`/`suite`/hooks registering into a per-run registry. The `@effect/vitest` harness implements the registration variants (`it.effect`, `it.scoped`, `it.live`, `it.layer`, `it.prop`) mirroring the semantics of `repos/effect/packages/vitest` (vendored reference: Effect run-loop with test-context signal, Layer provisioning and scoping, `Cause.prettyErrors` into the failure message, property loops over `effect/unstable/arbitrary`). The gherkin harness re-exports the real package's own symbols (`Given`/`When`/`Then`/`makeFeature`, imported by absolute URL) plus the `@effect/vitest` harness surface, so `makeFeature({ it, layer })` receives the registry-backed `it`; the real gherkin package's own dormant internal `@effect/vitest` import is never driven. Governs R1, R2, R4, R5, R6, R7, R8; instantiates KD1, KD4.
- KTD3. **Per-run isolation by salted re-import, replacing the vm context.** Each dry/mutant run re-imports the sandbox entry test files (and, by resolve-hook propagation of the `?salt=` query, every sandbox-resident module in the graph) so user code and instrumented sources re-evaluate per run; `node_modules` externals stay cached across runs for speed. The `__stryker__` namespace stays on the host global as today, set per run around the drain. The single-script vm context machinery (`compileTests` concatenation, `sandboxFor`, `runInFreshContext`) is removed. Governs R2, R9; instantiates KD3. The existing sandbox already spread host `globalThis`, so realm isolation was cosmetic; the no-spawn canary contract is preserved unchanged.
- KTD4. **TypeScript checker is untouched by the runner mechanism.** The checker typechecks sandbox sources against real installed `.d.ts` before mutants reach the runner; interception and native type-stripping are runtime-only and never inputs to typechecking. `CompileError` classification is unchanged. Governs R3.
- KTD5. **Unsupported surfaces fail fast.** `toMatchSnapshot` and `vi.mock` produce a named, explanatory failure at call time (no silent skip, no silent survival); the error text names `testRunner: 'vitest'` as the route for those features. Detection is via the real vitest runtime hooks where available, not static analysis. Instantiates the deferred-items contract in Scope Boundaries.
- KTD6. **Node `>=24.13.1` becomes the engine floor.** The engines field moves from `>=22.18.0` to `>=24.13.1`, where `module.registerHooks` is release-candidate stable and native type-stripping is mature; no 22.x/23.x support is retained. Governs R10; instantiates KD5.

### Spike Verification (in-session, Node v24.20.0)

- `module.registerHooks()` interception scoped to sandbox-origin parents (verified twice: once via `module.register()` with data plumbing, once via in-thread `registerHooks()`): non-sandbox imports untouched; harness-parent bare imports resolve via parentURL re-basing onto the sandbox URL.
- Real `expect`/`vi` re-exported through the harness: **verified** — failure text came from the installed Vitest's real matcher stack (`expected 2 to be 3 // Object.is equality`).
- Native TypeScript loading of `.ts` test and source files: **verified** — zero flags, zero bundling, zero sourcemaps (stack traces reference original files).
- Per-run fresh module state via salted re-import: **verified** — module-level state reset across two sequential runs; `node_modules` stayed cached.
- Vitest 5 is ESM-only (`require('vitest')` throws by design); `TestRunner`, `startTests`, and vitest's own `SyntheticModule` evaluator are worker/rpc-coupled internals with no public third-party driving path: **verified refutation** of the bundle-plus-real-collector alternative.

### Assumptions

- The `@effect/vitest` registration variants the adapter must mirror are stable at `4.0.0-rc.116` (pinned by the workspace catalog); the vendored `repos/effect/packages/vitest` source is the semantic reference. Verified per-variant by U2 fixtures.
- Gherkin harness composition (real own symbols plus harness `@effect/vitest` surface) preserves `makeFeature` wiring; the dormant internal import of real `@effect/vitest` inside the real gherkin package is never driven. Verified by U3's wrapper-chain regression.
- `module.register()` and native type-stripping behave identically on the Node 22.18 engine floor (spike ran on 24.20; 22.18 first shipped both unflagged). Verified once on CI's oldest-engine job (U5).
- Top-level await in test files is out of scope; if a run hangs on an unevaluated graph it hits the drain timeout with a named error.

### Risks

- **Registration-semantics drift** between the first-party `it`/hook layer and real Vitest (`.only` filtering, `.each` expansion, hook ordering, concurrent mode) is the widest surface. Mitigation: property tests over the registry decision core; fixtures mirroring `packages/stryker-js-vitest-runner/testResources/`; mutation-dogfooding the harness code itself.
- **`it.prop` property-loop fidelity** (seed, runs budget, shrinking) diverging from `@effect/vitest`. Mitigation: mirror the vendored internal implementation; U2 scenario asserting failing-property text and determinism under a fixed seed.
- **Unhandled rejections escaping the drain** (async test bodies rejecting after timeout). Mitigation: run-scoped unhandledRejection trap folded into the run result; U4 timeout scenario.
- **ESM loader-hook process-global registration** interacts with other in-process loaders if a user's environment chains `register()`. Mitigation: hooks chain via `next()` only; document the interception set.

### Alternatives Considered

- **tsdown/esbuild bundling of sandbox tests with externals + real collector driven in-process** — refuted by spike: vitest 5 cannot be `require`d (ESM-only, breaks CJS bundle externals) and its collector/runner APIs are worker-coupled internals (no public `startTests`/`collectTests` export; `TestRunner` self-wires from `__vitest_worker__` state; the vm evaluator needs `workerState.rpc`). Bundling would still be needed only for TS, which Node ≥22.18 strips natively.
- **`vm.SourceTextModule` + `SyntheticModule` linker** — requires `--experimental-vm-modules` on Node 22–24 (verified on v24.20.0: `SyntheticModule is not a constructor` without the flag) plus cross-realm identity hazards; vitest's own vm machinery exists but is rpc-coupled; rejected.
- **`@vitest/runner` standalone driving** — no such package in vitest 5 (inlined; run chunk exports are internal chunk-hash URLs); rejected as brittle deep-import surface.

---

## Implementation Units

### U1. Interception wiring and vitest harness core

- **Goal:** Sandbox-scoped interception, registry, real `expect`/`vi` re-export, and per-test drain — the spike hardened into the runner.
- **Requirements:** R1, R2, R3, R5, R6, R9; AE1.
- **Dependencies:** none.
- **Files:** `packages/stryker-js/src/VmRunner.ts`; new registry/harness modules colocated in `packages/stryker-js/src/`; property tests under `packages/stryker-js/src/__tests__/`; `packages/stryker-js/tests/vm-runner.integration.test.ts`.
- **Approach:** Port the spike: hooks module (sandbox-scoped interception set `{vitest, @effect/vitest, @systemfsoftware/effect-gherkin-spec}`, harness-parent re-basing), per-run registry with suite-tree state, real-runtime re-exports, drain with timeout and unhandledRejection trap, salted re-import replacing `compileTests`/`runInFreshContext` (KTD1–KTD3). Registration decision core (suite tree, `.skip`/`.only` filtering, `.each` expansion, hook ordering) is a pure module with property tests.
- **Patterns to follow:** Existing Gherkin integration structure in `vm-runner.integration.test.ts` (worker/spawn canaries, temp-directory fixtures); registry purity follows `src/__tests__/*.workflow.property.test.ts` conventions.
- **Test scenarios:**
  - Integration: AE1 end to end — per-test records, hook order, real matcher failure text, real `vi.fn()`.
  - Integration: interception is sandbox-scoped — a non-sandbox import of `vitest` in the same process resolves the real module.
  - Integration: two sequential runs observe fresh sandbox module state (salt) while `node_modules` imports stay cached.
  - Property: suite-tree construction and `.skip`/`.only`/`.each` filtering invariants over generated declarations.
- **Verification:** Scoped `pnpm test` on the integration file plus property suite; canaries (no worker/child spawn) remain.

### U2. `@effect/vitest` adapter harness

- **Goal:** Registry-backed `it.effect`/`it.scoped`/`it.live`/`it.layer`/`it.prop` with Effect semantics.
- **Requirements:** R7; AE2.
- **Dependencies:** U1.
- **Files:** adapter module under `packages/stryker-js/src/`; `packages/stryker-js/tests/vm-runner.integration.test.ts` with fixtures under `packages/stryker-js/testResources/`.
- **Approach:** Mirror `repos/effect/packages/vitest/src/internal/internal.ts` semantics: run-loop honoring the test-context signal, `Cause.prettyErrors` into `failureMessage`, Layer provisioning per variant, `it.prop` property loop over `effect/unstable/arbitrary` with fixed-seed determinism (KTD2).
- **Test scenarios:**
  - Integration: `it.effect` passing and failing — failure record carries formatted Effect cause (AE2 mutant-killed mapping).
  - Integration: `it.prop` passes on invariant-holding schema and reports property-failure text on violation, deterministic under fixed seed.
  - Integration: `it.scoped` with a Layer — resource acquisition and release observed per test.
- **Verification:** AE2 demonstrated; scoped integration suite green.

### U3. Gherkin composition harness

- **Goal:** Real gherkin symbols composed with the harness `@effect/vitest` surface; wrapper-chain regression.
- **Requirements:** R8; AE3.
- **Dependencies:** U2.
- **Files:** gherkin harness module under `packages/stryker-js/src/`; integration scenarios and fixtures.
- **Approach:** Harness for `@systemfsoftware/effect-gherkin-spec` re-exports the real package's own symbols via absolute-URL import plus the U2 adapter surface; `makeFeature({ it, layer })` receives the registry-backed `it` (KTD2).
- **Test scenarios:**
  - Integration: `makeFeature` feature with scenario outline — one record per row, row-parameterized names (AE3).
  - Integration: wrapper-chain regression — `it` imported from the gherkin package re-export registers into the same drain as direct `@effect/vitest` imports.
  - Integration: real gherkin's dormant internal `@effect/vitest` import causes no double-registration.
- **Verification:** AE3 demonstrated; wrapper-chain regression green.

### U4. Runner integration: run mapping, isolation, instrumentation globals

- **Goal:** Dry-run/mutant-run contracts over the drain; per-run isolation; `__stryker__` propagation to sandbox modules.
- **Requirements:** R2, R9; AE1, AE2.
- **Dependencies:** U1, U2, U3.
- **Files:** `packages/stryker-js/src/VmRunner.ts`; `packages/stryker-js/tests/vm-runner.integration.test.ts`.
- **Approach:** Map registry outcomes to `DryRunResult`/`MutantRunResult` (per-test IDs `filepath#suite names > test [each-row]`, statuses, `timeSpentMs`, `failureMessage`); active-mutant set around each run against the host `__stryker__` namespace; drain timeout with named timeout error and unhandledRejection trap (KTD3).
- **Test scenarios:**
  - Integration: mutant run with an instrumented sandbox source — noticing-suite kills the mutant via the specific test's failure (per-test kill mapping, not monolithic).
  - Integration: timeout scenario — hanging async test fails with named timeout error, run completes.
  - Integration: reload semantics — same bundle of test+src files re-evaluated per run; state from run N cannot leak into run N+1.
  - Integration: malformed TS still surfaces `TestRunnerFailed` phase `init` naming the file (existing contract preserved through native loading).
- **Verification:** Scoped integration suite green; existing canaries and contracts preserved.

### U5. Guards, engines bump, cleanup

- **Goal:** KTD5 fail-fast contracts; engine floor raised to `>=24.13.1`; spike scaffolding removal.
- **Requirements:** R9, R10; Scope Boundaries deferred items.
- **Dependencies:** U4.
- **Files:** `packages/stryker-js/package.json` (engines); `packages/stryker-js/src/VmRunner.ts`; `packages/stryker-js/tests/vm-runner.integration.test.ts`; CI matrix if a 22.x job must be dropped or repinned.
- **Approach:** `toMatchSnapshot`/`vi.mock` named errors routing to `testRunner: 'vitest'`; engines field `>=22.18.0` → `>=24.13.1` with CI oldest-job repinned accordingly; remove scratch spike artifacts and throwaway fixtures (KTD5, KTD6).
- **Test scenarios:**
  - Integration: `toMatchSnapshot` fixture yields named unsupported error, never a silent pass.
  - Integration: `vi.mock` fixture yields named unsupported error routing to the vitest runner.
  - Packaging: engines field and CI matrix reflect Node `>=24.13.1`; no 22.x job remains.
- **Verification:** No fixture can false-pass through an unsupported surface; engines and CI matrix consistent.

---

## Verification Contract

- `pnpm format:check`, `pnpm typecheck`, `pnpm test` — START-1/2/3 gates; `packages/stryker-js/tests/vm-runner.integration.test.ts` is the primary behavioral proof.
- `pnpm check:ci` — START-4 workspace verification (gate tasks + dist).
- `./scripts/check-changeset.ts $(git merge-base HEAD origin/main)` — START-5 change intent for `packages/stryker-js`.
- `git grep -F 'catalog:stryker' -- packages/stryker-js/package.json packages/stryker-js-vitest-runner/package.json packages/stryker-js-typescript-checker/package.json` — START-6 dogfood target unchanged across all three packages.
- Mutation dogfood on the new harness code paths stays on `catalog:stryker` `latest` (no runner self-selection change).
- TypeScript checker coexistence: `checker-rpc.integration.test.ts` remains green; checker orthogonality is covered by KTD4 — no checker edits are in scope for this plan.

## Definition of Done

- All Requirements R1–R10 demonstrated by the integration scenarios that implement them; AE1–AE3 pass with R4 and R6 asserted inside AE1's scenario set, R10 by the U5 packaging scenario.
- Spike outcomes recorded above remain accurate against the final implementation (verified assumptions, not stale claims).
- Existing vm-runner contracts preserved: init-phase compile failures, no worker/child spawn for in-memory runs (canaries stay).
- Scratch spike scaffolding and throwaway fixtures removed from the diff; only fixture suites backing integration scenarios remain.
- All Verification Contract gates green; changeset present for `packages/stryker-js`.

---

## Part 2: VM Harness Package & Pure Cell Refactor

Consolidated from the former `2026-09-21-0535-feat-stryker-vm-harness-package-plan.md` and `2026-09-21-0600-refactor-vm-harness-package-plan.md` (REPO-D2: one plan per pull request). The runner compatibility work above landed first; this part extracts its harness into `@systemfsoftware/stryker-vm-harness`.

### Goal Capsule

Extract the in-memory VM test-runner harness from `@systemfsoftware/stryker-js` into a dedicated workspace package (`@systemfsoftware/stryker-vm-harness`), and restructure its state management and execution pipelines to adhere religiously to `@systemfsoftware/effect-cell-types` (`Cell`, `Sandwich`, `Workflow`) and the repo's Pure Core / Imperative Shell constitutional architecture (CONST-P1, CONST-P2, CONST-B3).

- **Objective**: The VM harness is an independently publishable, strictly-typed package whose pure decision core is single-path (cyclomatic complexity 1) and whose impure shell is a thin `read -> transform -> write` sandwich.
- **Means**: Extract `packages/stryker-js/src/vm-harness/*` into `packages/stryker-vm-harness/`, wrapping registry, drain, interception, and global-state in typed `Workflow`/`Sandwich` cells; `VmRunner.ts` in `packages/stryker-js` consumes the new package as a workspace dependency.
- **Authority hierarchy**: `CONSTITUTION.md` > `AGENTS.md` > plan Product Contract > Implementation Units > code.
- **Stop conditions**: All unit tests, integration tests, and container e2e tests pass; `@systemfsoftware/oxlint-plugin-effect-dmmf` reports zero violations; no new suppression comments.
- **Execution profile**: Standard refactor, 4–6 units, ordered by dependency.
- **Who finishes and ships**: `ce-work` with subagent-driven development, simplification, code review, and commits.

---

### Product Contract

#### Summary

The current VM harness lives inside `packages/stryker-js/src/vm-harness/` as a set of loosely-coupled modules with mutable global state, procedural registry manipulation, and ad-hoc effect management. This plan extracts it into a standalone `@systemfsoftware/stryker-vm-harness` package and restructures it to follow the Effect DMMF (Domain Model, Model, Function) and `@systemfsoftware/effect-cell-types` patterns already established in sibling packages (`stryker-js-vitest-runner`, `stryker-js-typescript-checker`).

#### Problem Frame

The VM harness is the only first-party runner component that is not a standalone workspace package, and it is the only one that does not use `Cell`, `Sandwich`, or `Workflow` for its execution pipelines. Its mutable global-state cell, procedural `drainRegistry` executor, and imperative `interception.ts` sandbox stack make it hard to reason about, test, and reuse outside the Stryker CLI.

#### Requirements

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

#### Success Criteria

- `pnpm check:ci` passes for the whole workspace.
- `pnpm --filter @systemfsoftware/stryker-vm-harness test` passes.
- `pnpm --filter @systemfsoftware/stryker-js test` passes.
- `pnpm --filter @systemfsoftware/stryker-js mutation` runs without new surviving mutants in `VmRunner.ts` or the extracted harness.
- CI green: `check (ubuntu-latest)`, `check (macos-latest)`, `e2e`, `Mutation`, `Changeset Check`, `Commitlint`.

#### Scope Boundaries

**Deferred for later**

- Refactoring `stryker-js-vitest-runner` or `stryker-js-typescript-checker` to share common harness primitives beyond the new package.
- Moving `VmRunner.ts` orchestration into `packages/stryker-vm-harness` (the runner shell stays in `packages/stryker-js`).

**Outside this product's identity**

- Changing the Vitest, `@effect/vitest`, or Gherkin API surface the harness supports.
- Supporting Jest, Mocha, or other test frameworks in the VM harness.

#### Key Decisions

- **KD1.** Extract into a dedicated workspace package rather than refactor in-place. Rationale: the harness is reusable outside the Stryker CLI and needs its own publishable API surface, mutation cell, and test contract. Governs R1, R2, R3.
- **KD2.** Strictly adopt `@systemfsoftware/effect-cell-types` (`Cell`, `Sandwich`, `Workflow`) rather than raw `Effect.gen` + mutable state. Rationale: matches sibling packages, enforces pure-core/imperative-shell separation, and satisfies CONST-P1/P2/B3. Governs R4, R5, R6.

#### Outstanding Questions

None. All product decisions are settled in the brainstorm and this plan.

---

### Planning Contract

#### Key Technical Decisions

- KTD1. **Package boundary.** Create `packages/stryker-vm-harness/` as a sibling to `packages/stryker-js/`, not a sub-package. Rationale: matches the existing monorepo layout (`packages/stryker-js-*`, `packages/ignorers/*`) and keeps the harness independently versioned and publishable. Cites R1, R2.
- KTD2. **Pure core files.** The pure decision core lives in `packages/stryker-vm-harness/src/core/` (registry planning, drain interpretation, status mapping) and has cyclomatic complexity 1. Rationale: CONST-P2 and `@systemfsoftware/oxlint-plugin-effect-dmmf` enforce this. Cites R5.
- KTD3. **Imperative shell files.** The impure shell lives in `packages/stryker-vm-harness/src/shell/` (module interception, sandbox activation, native import, global-state cell) and is expressed as `Sandwich`/`Cell` pipelines with no decisions. Rationale: CONST-B3 and CONST-P1. Cites R4, R6.
- KTD4. **Public API surface.** The package exports only typed services and pure workflows from `src/index.ts`; internal shell/core modules are not re-exported. Rationale: prevents consumers from coupling to implementation details. Cites R3.
- KTD5. **Test strategy.** Pure core is tested with property-based tests (`fast-check`) and mutation tests; shell is tested with integration tests using the real VM. Rationale: matches sibling packages (`stryker-js-instrumenter`, `stryker-js-vitest-runner`). Cites R7, R8.

#### Assumptions

- The current `vm-harness` code compiles and passes all existing tests on this branch.
- `@systemfsoftware/effect-cell-types` `^8.3.1` provides the required `Cell`, `Sandwich`, and `Workflow` primitives.
- No changes to `packages/stryker-js/src/VmRunner.ts` semantics are required beyond replacing `vm-harness` imports with `@systemfsoftware/stryker-vm-harness` imports.

#### Sequencing

1. Scaffold `packages/stryker-vm-harness/` with build, test, and lint configuration.
2. Extract pure core (registry, drain, each-name, sources, guards) into `packages/stryker-vm-harness/src/core/`.
3. Extract imperative shell (interception, global-state, effect-adapter) into `packages/stryker-vm-harness/src/shell/`.
4. Wrap core and shell in `Workflow`/`Sandwich` cells and expose public API in `src/index.ts`.
5. Update `packages/stryker-js/src/VmRunner.ts` to consume the new package and delete `packages/stryker-js/src/vm-harness/`.
6. Run full verification and mutation dogfood.

---

### Implementation Units

#### U1. Scaffold `@systemfsoftware/stryker-vm-harness` package

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

#### U2. Extract pure core into `packages/stryker-vm-harness/src/core/`

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

#### U3. Extract imperative shell into `packages/stryker-vm-harness/src/shell/`

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

#### U4. Wire public API and update `packages/stryker-js`

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

#### U5. Container e2e and mutation dogfood

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

### Verification Contract

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

### Definition of Done

- All Implementation Units are committed to the `v8-vm` branch.
- `pnpm check:ci` passes on a fresh clone.
- `pnpm --filter @systemfsoftware/stryker-js mutation` shows no new surviving mutants in `VmRunner.ts` or the extracted harness.
- All container e2e tests pass in `node:24-alpine`.
- CI green on the final head commit.
- No dead-end or experimental code remains in the diff.
