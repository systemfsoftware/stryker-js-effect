---
title: VM Runner Runs Vitest - Plan
type: refactor
date: 2026-09-25
topic: vm-runner-runs-vitest
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
supersedes: docs/plans/2026-09-25-0624-refactor-vm-runner-vitest-delegation-plan.md
execution: code
---

# VM Runner Runs Vitest - Plan

## Goal Capsule

- **Objective:** A project that runs Stryker with `testRunner: 'vm'` gets exactly the per-test results and mutant verdicts Vitest itself produces, from a runner that carries no hand-written copy of Vitest behaviour.
- **Means:** `testRunner: 'vm'` runs the vitest runner on Vitest's isolated `threads` pool. `@systemfsoftware/stryker-vm-harness` is deleted.
- **Product authority:** This plan covers the vm runner's execution model and its parity proof. Bringing stryker-js core in line with cell-architecture, and a whole-repo audit against the compound packs, are out of scope.
- **Open blockers:** None.
- **Stop conditions:** Stop and return to planning if the vm runner's per-mutant statuses on the enterprise fixture differ from the vitest runner's, or if its median run time on that fixture exceeds 1.1x the vitest runner's.
- **Execution profile:** One pull request from `refactor/vm-runner-vitest-delegation`, cut from the fix-sweep branch (PR #110). Merging stays with the user.

## Why this supersedes the 06:24 plan

The superseded plan's decision gate (U2) ran on 2026-09-25 against `test/e2e/testResources/enterprise-monorepo-fixture` (319 mutants; one warm-up, median of three measured runs; `stryker run` through the CLI, same config per arm):

| Arm                                          | Median        | Per-mutant statuses vs the stock vitest runner               |
| -------------------------------------------- | ------------- | ------------------------------------------------------------ |
| vm runner (fix sweep plus #100b's patches)   | 13.9 s        | 144 of 319 differ (133 Survived against 29; 31 RuntimeError) |
| stock vitest runner (`forks`, isolated)      | 22.4 s        | reference                                                    |
| vitest runner on `threads` (isolated)        | 20.9 s        | none differ                                                  |
| vitest runner on `vmThreads`                 | 23.4 s        | none differ                                                  |
| vitest runner on `threads`, `isolate: false` | dry run fails | not comparable                                               |

Two findings break the superseded plan's gate:

1. The vm runner's speed comes from verdicts that do not run the tests. A 1.25x gate against it would reject every arm that matches Vitest. The throughput bar is therefore re-based on the stock vitest runner.
2. Non-isolated workers diverge from Vitest by construction. `vitest run --pool threads --no-isolate --maxWorkers=1` itself fails the fixture: a `vi.mock('./clock.js')` has no effect once another file loaded the module in the same worker. The warm path keeps Vitest's per-file isolation.

The in-process custom-pool arm (superseded U5) is not built. Isolation, not Vitest start-up, is the per-run cost: the vitest runner already keeps one `Vitest` instance per runner (`packages/stryker-js-vitest-runner/src/VitestSession.service.ts`, `Effect.cached` runtime), and `vmThreads`, which reuses workers, was not faster than `threads`.

---

## Product Contract

### Summary

`testRunner: 'vm'` stops re-implementing Vitest and runs it. The built-in runner becomes the vitest runner on Vitest's isolated `threads` pool, so parity with `vitest run` holds by construction, and the 8,100-line harness package is deleted.

### Key Decisions

- **Path C on the isolated `threads` pool.** (agent-recommended after the U2 measurement, auto-selected when the decision question timed out; the user may reverse it) Governs R1, R2.
- **Throughput is judged against the stock vitest runner, not the old vm runner.** The old vm runner's time is not a valid baseline (Why this supersedes, finding 1). Governs R9.
- **`testRunner: 'vm'` remains a valid config value.** It is a public config contract. (session-settled: user-approved in the superseded plan) Governs R1.
- **The dogfood pin is untouched.** `stryker-js` keeps `@systemfsoftware/stryker-js-vitest-runner` as `catalog:stryker` in `devDependencies` (AGENTS.md Dogfood, START-6). The runtime dependency uses a pnpm workspace alias, which `pnpm pack` rewrites to `npm:@systemfsoftware/stryker-js-vitest-runner@^<version>` (verified on pnpm 11.21). Governs R3.

### Requirements

**Execution**

- R1. `testRunner: 'vm'`, and a config with no `testRunner`, run `@systemfsoftware/stryker-js-vitest-runner` with Vitest's `threads` pool and Vitest's default per-file isolation.
- R2. Under `vm`, a Vitest config that enables browser mode for any project fails initialization with a refusal that names `testRunner: 'vitest'`, before any module is transformed. Under `testRunner: 'vitest'` the same config is not refused.
- R3. A project that installs only `@systemfsoftware/stryker-js` and `vitest` completes a `vm` dry run under pnpm's default isolated `node_modules` (the #105 contract).

**Parity**

- R4. On every parity fixture and on the enterprise fixture, the vm runner reports the same dry-run test ids and outcomes, and the same per-mutant statuses, as real Vitest.
- R5. The e2e journeys `enterprise-mutator-edge-cases`, `enterprise-composite-checker`, `enterprise-mutation-lifecycle` and `enterprise-monorepo-sabotage` pass with their fixture configs set to `testRunner: 'vm'`.

**Subtraction**

- R6. `packages/stryker-vm-harness` is deleted, with its workspace, turbo, changeset and documentation references. Nothing in the workspace imports it.
- R7. Mutant arming, hit limits, per-test coverage and result-to-test-id mapping exist once, in the vitest runner.
- R8. Tests whose only subject was a harness mechanism are deleted with it. The `vm`-specific contracts that remain (pool choice, browser refusal, alias resolution) are tested where they now live.

**Throughput**

- R9. On the enterprise fixture, the shipped `vm` median is at most 1.1x the stock vitest runner's median, measured as in the table above.

### Acceptance Examples

- AE1. Browser refusal. **Given** a fixture whose Vitest config enables browser mode, **when** Stryker starts with `testRunner: 'vm'`, **then** initialization fails with a message naming `testRunner: 'vitest'` and no mutant is reported.
- AE2. Mutation-run parity. **Given** the enterprise fixture, **when** it runs once on `vitest` and once on `vm`, **then** every mutant has the same status under both. The old vm runner reported 31 runtime errors against 0.

### Scope Boundaries

- The `vitest` runner's own pool choice is unchanged: it keeps whatever the project's Vitest config selects.
- Suites that need `forks` (`process.chdir`, native addons that are not thread-safe) use `testRunner: 'vitest'`. The README says so.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **`vm` is resolved into a custom test-runner config at the point the engine builds runners.** `TestRunner.blueprint.ts` stops routing `vm` to an in-process runner. It builds the child-process runner with `testRunner` replaced by `{ plugin: <file URL of the aliased vitest runner, resolved from stryker-js's own module>, options: { pool: 'threads' } }`, so the pooled-runner wrappers (timeout, max reuse, environment reload, retry) apply as they do to every plugin runner.
- KTD2. **The pool and the refusal live in the vitest runner.** `VitestRunnerOptionsSchema` gains an optional `pool` (`'threads'`). When set, `createVitestConfig` passes it to Vitest, and init refuses a resolved config whose projects enable browser mode. A project that sets no `pool` option keeps today's behaviour.
- KTD3. **Parity is proven against real Vitest in-process.** `packages/stryker-js/tests/vm-parity.differential.test.ts` keeps its reference arm. Its candidate arm is the `vm` runner through the engine, compared per mutant.

### Implementation Units

#### U1. Vitest runner: `pool` option and browser refusal

**Files:** `packages/stryker-js-vitest-runner/src/VitestRunner.schema.ts`, `VitestRuntime.blueprint.ts`, the init path in `VitestRunner.service.ts`, tests beside them, `README.md`, a changeset (minor).
**Test scenarios:** a `pool: 'threads'` session runs a fixture on worker threads; a browser-enabled fixture with `pool` set fails init naming `testRunner: 'vitest'`; the same fixture without `pool` is not refused.

#### U2. Route `vm` through the vitest runner

**Files:** `packages/stryker-js/src/TestRunner.blueprint.ts`, `VmRunner.blueprint.ts` (reduced to the name check and the config rewrite), `read-project.parts.ts` (drop the vm-only test-file discovery), `Plugin/mod.ts` exports, `package.json` (swap the harness for the aliased vitest runner), `tests/vm-runner.integration.test.ts`.
**Test scenarios:** a config with no `testRunner` runs a real fixture through the vitest runner on threads; `vm` resolves the runner from stryker-js's install, not the project's; a browser fixture under `vm` is refused (AE1).

#### U3. Parity differential on the new `vm`

**Files:** `packages/stryker-js/tests/vm-parity.differential.test.ts`, `packages/stryker-js/testResources/vm-parity/`.
**Test scenarios:** every fixture's dry-run outcomes and per-mutant statuses match real Vitest; `hangs` reports `Timeout` under both.

#### U4. Delete the harness and switch the enterprise journeys

**Files:** `packages/stryker-vm-harness/` (deleted), `pnpm-workspace.yaml`/turbo/tsconfig references, `.changeset/` (harness-only pending changesets removed; one changeset per affected package), `packages/stryker-js/README.md`, `test/e2e/testResources/enterprise-monorepo-fixture/stryker*.config.ts` (`testRunner: 'vm'`).
**Verification:** the #105 fresh-pnpm smoke check passes; R9 is re-measured.

### Verification Contract

- `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm check:ci` pass at the repo root.
- `./scripts/check-changeset.ts $(git merge-base HEAD origin/main)` passes.
- `pnpm --filter @systemfsoftware/stryker-js-vitest-runner build` passes the PLUG-1 gate.
- The e2e lane passes, including the four enterprise journeys on `vm`.
- R9 holds on the enterprise fixture.

### Definition of Done

- `packages/stryker-vm-harness` no longer exists and nothing imports it.
- AE1 and AE2 hold.
- No benchmark scaffold or prototype remains in the diff.
- The redesign pull request is open with gates green; #100 closes through it.
