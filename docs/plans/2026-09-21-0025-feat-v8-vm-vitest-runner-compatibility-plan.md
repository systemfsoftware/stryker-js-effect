---
title: Vitest Compatibility in Stryker V8 Runner
created_at: 2026-09-21-0025
updated_at: 2026-09-21-0147
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
