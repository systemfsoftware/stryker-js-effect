---
title: Check Critical Path - Plan
type: perf
date: 2026-10-11
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Check Critical Path - Plan

## Goal Capsule

- **Objective:** A maintainer or agent opening a PR that changes `packages/stryker-js` gets the required `check` verdict within 10 minutes of wall time, cold or warm, from the same tasks and assertions that run today.
- **Means:** Run `stryker-js#test` on parallel shards that each build their inputs from the Turbo cache, make the α-Conversion property's runs cheaper, stop building `gritlint` on the path, keep main's Turbo entry fresh when main's Gate fails, and publish each part's Turbo run summary.
- **Product authority:** This plan refines U6 and KTD10 of `docs/plans/2026-10-10-0702-perf-ci-wall-clock-plan.md`, replaces that plan's KTD3 save rule, and binds U2's KTD6 as the `gritlint` mechanism. It governs `.github/workflows/ci.yml`'s `check` jobs, root `package.json` scripts, `turbo.json`, the `stryker-js` Vitest sharding input, the two slow `stryker-js` test files (moved scenarios only), and the α-Conversion helper in `test/e2e-core/tests/analyzer.differential.test.ts`. The e2e legs (U3–U5, #291), checker-parity (#266), and `mutation.yml` are outside it.
- **Open blockers:** none.

---

## Product Contract

### Summary

Split `check` into parallel parts so the 13.4-minute `stryker-js#test` task runs as three balanced shards, each building what it needs from the Turbo cache. Make the α-Conversion property's 300 runs cheap enough that `e2e-core#test` stops setting a 7-minute floor on the remaining part. Together with a cached `gritlint` and a main cache that survives a red Gate, the projected cold `check` is about 8.5 minutes and warm about 6.3.

### Problem Frame

Every PR that touches `stryker-js` waits 20–22 minutes for `check`, and caching cannot fix it: one test task alone runs 13.4 minutes on a fully warm graph. The measurements come from #303's two `check` runs, [38105648999](https://github.com/systemfsoftware/stryker-js-effect/actions/runs/38105648999) (job 21.6 min) and [38108376853](https://github.com/systemfsoftware/stryker-js-effect/actions/runs/38108376853), their Vitest and Turbo log lines, a local `turbo --dry=json` diff between the restored cache commit and the PR head, and throwaway probes run once and deleted. `TURBO_RUN_SUMMARY` is set, but `.turbo/runs/*.json` is never uploaded, so per-task times were rebuilt from group timestamps and Vitest output.

**Critical path of `check`, run 38105648999 (cold)**

| Segment                                                                                            | Minutes |
| -------------------------------------------------------------------------------------------------- | ------: |
| Job setup before the Gate (checkout, Nix, pnpm install, cache restores)                            |     1.2 |
| `format:check`                                                                                     |     0.1 |
| `lint:conventions`: `gritlint` compiled from source by Nix, then run (29 of 29 runs, median 179 s) |     2.9 |
| Turbo graph (`lint`, `lint:tsgo`, `typecheck`, `test` at concurrency 4), 53 of 120 cached          |    17.3 |
| `gate:dist`                                                                                        |    0.02 |

Inside the Turbo graph of 38108376853, upstream builds end at 1.4 minutes and `stryker-js#build` at 3.6, while lint and tsgo tasks hold the four slots. `stryker-js#test` starts at 4.6 and runs 13.4 minutes: Vitest reports 803.6 s for 266 files, 2,112 file-seconds at 2.63 files in flight on average. `e2e-core#test` runs from 3.8 to 11.2 minutes. Concurrency, not serial ordering, is not the main cost: the chain is serial, and the longest task decides it.

**Slowest test files (CI Vitest per-file durations)**

| File                                                             | Seconds | Shape                                               |
| ---------------------------------------------------------------- | ------: | --------------------------------------------------- |
| `stryker-js` `tests/compile-error-reuse.integration.test.ts`     |   366.0 | 11 scenarios, 52 engine runs, median 6.1 s per run  |
| `stryker-js` `tests/incremental-reuse.integration.test.ts`       |   351.6 | 18 scenarios, 74 engine runs, median 3.7 s per run  |
| `stryker-js` `tests/vm-parity.differential.test.ts`              |   240.3 | one scenario, 6 engine runs                         |
| `stryker-js` `tests/lockfile-closure-digest.integration.test.ts` |   112.0 | 33.6 s locally after #303 cut its hoisting scenario |
| `stryker-js` `tests/dry-run-failure.integration.test.ts`         |    94.8 |                                                     |
| `e2e-core` `tests/analyzer.differential.test.ts`                 |   438.9 | α-Conversion property 341–414 s of it, 300 runs     |
| `e2e-core` `tests/placement.integration.test.ts`                 |   161.3 | next-longest `e2e-core` file                        |

**Why the two `stryker-js` files are slow.** Real engine runs take 347 of `compile-error-reuse`'s 366 s and 323 of `incremental-reuse`'s 352 s. There are many runs because each scenario drives two to four engine runs, and `@systemfsoftware/vitest` runs every passing test a second time on a fresh build to catch leaked state. That re-run is a house gate and stays. Each run's time goes to fixed engine phases, not to the fixture:

| Phase, median per engine run                         | `compile-error-reuse` | `incremental-reuse` |
| ---------------------------------------------------- | --------------------: | ------------------: |
| Config and file discovery                            |                0.11 s |              0.13 s |
| Initial test run (runner spawn, Vitest boot, 1 test) |                2.25 s |              2.04 s |
| Mutant phase (checker and runner processes)          |                4.02 s |              2.99 s |
| Runner-reported overhead inside the initial run      |                0.55 s |              0.46 s |

The fixture checker (`tests/__fixtures__/program-digesting-checker/worker.mjs`) reads three files and answers in microseconds, yet one deferred run spends 5.1 s between `Deferring the initial test run` and `No valid mutant was tested`. Worker module boot is not the cost: the worker's `@effect/platform-node` barrel import costs 0.1–0.2 s more than subpath imports per process, at most about 0.4 s of a 6.1-second run with two checker processes. The rest is engine-side (process pool, RPC, runner sandbox), and these logs cannot attribute it. A source-level cut in the test files therefore saves at most about 5% [INFERENCE: two worker processes per run at the measured import delta]. The larger cut is in the engine's per-run fixed cost, a product change that would speed every engine run in every suite and needs a trace before it can be sized (Q1).

**Why α-Conversion is slow.** `alphaRename` builds a new in-memory ts-morph `Project` for each of the 300 inputs and calls `rename()` per declaration. The first rename builds a type-checked program that includes TypeScript's lib `.d.ts` files, so every run pays the lib load. Local probe, one 36-line input:

| Step                       | Libs loaded | `skipLoadingLibFiles` |
| -------------------------- | ----------: | --------------------: |
| `Project` plus source file |      0.8 ms |                0.1 ms |
| plus first rename          |    100.3 ms |                0.9 ms |
| plus every rename          |    133.0 ms |               19.8 ms |

Renamed text was identical with and without libs. CI's 414 s over 300 runs is 1.38 s per run; at the local ratio it would be about 54 s [INFERENCE: assumes CI keeps the 7.7x local ratio]. The Monotonic Subtraction property runs the same analyser 300 times in 3.9 s, which confirms the rename, not the analyser, is the cost.

**Why the cache was cold.** The PR's base, `ec9dcf63c`, had no Turbo entry: main's `check` failed there on the stale `cli-contract` baseline, and the save rule (KTD3) stores nothing unless the Gate passed. The PR fell back to `56426ca94`'s entry, two commits older. Of the 67 misses, 54 trace to #267's version bumps in package manifests, 6 to the new checker-parity package, 6 to #303's own `stryker-js` sources, and 10 to upstream build hashes only. `pnpm-lock.yaml` caused none, and the global hash was unchanged. The same pattern held for all 22 PR `check` runs since `ec9dcf63c` (53 of 120 cached, Gates of 13–21 minutes) against 105–115 cached and 4–7 minutes before it. A scratch-repository probe on Turbo 2.10.12 confirmed that a failed `--continue` run writes the cache entry of every task that succeeded and none for the task that failed, and that the next run hits the first and re-executes the second.

**Balance model.** Longest-processing-time packing of the 266 measured file durations, with each shard running three files at a time and the measured 1.12 contention factor: whole files give a 6.8-minute floor at any shard count, because `compile-error-reuse` alone is 408 s. With those two files split into scenario groups, three shards balance at 4.5 minutes, and more shards do not help: `vm-parity` (240 s, one scenario) sets the floor.

### Requirements

**Wall clock**

- R1. On a PR that changes `packages/stryker-js`, every job behind the required `check` name finishes within 10 minutes of wall time, cold and warm, and so does `check` from its first job start to its last job end.
- R2. The CI workflow as a whole finishes within 10 minutes of wall time on such a PR, cold and warm; its e2e legs reach that through #291 and U3–U5 of the parent plan, not through this plan.
- R3. The first cold run and one warm run on the branch record each shard's wall, the other parts' wall, the `check` wall, the workflow wall, and the measured build-closure time of each shard. If a cold shard, `check`, or the workflow exceeds 10 minutes, the next cut narrows what a shard builds to `stryker-js#test`'s own dependency closure.

**Coverage**

- R4. Every task that `check:ci` runs today still runs on every PR, in exactly one `check` part, with the same assertions.
- R5. Every `stryker-js` test file runs in exactly one shard. The summed per-shard test count equals the unsharded count from run 38108376853, 1,619 tests in 266 files, adjusted only for tests added or removed on the branch.
- R6. A test file with no recorded duration, including a new or renamed one, lands in the default shard, which runs every file the other shards were not given. A file assigned to zero shards or to two still fails `check` with its own reason code naming the file.
- R7. `compile-error-reuse` and `incremental-reuse` move into scenario-group files with every scenario and assertion unchanged. The test count and scenario names before and after are identical.
- R8. The α-Conversion property keeps its 300 runs, its generator, and its assertion. Only the cost of each run changes, and the renamed text is identical for the inputs CI generates.

**Required check**

- R9. The `check` name stays required and keeps its meaning: an aggregate job running under `if: always()` fails when any part fails, is cancelled, or is skipped, reading each needed job's result. One planted shard failure on CI proves this before the PR is ready, then is reverted.

**Cache**

- R10. Shard selection never enters the hash of any build task. On the warm run, every shard's build tasks are cache hits on the same hashes as the non-test part, shown by hit and miss lines in each step summary.
- R11. On main, a red Gate still saves the Turbo entries of the tasks that succeeded, so the next PR restores its base commit's entry. Tasks that failed are never cached. Cache keys are immutable per commit, so a passing re-run of the same commit cannot replace a red entry; its failed task stays a miss for PRs off that base until main's next commit.
- R12. No `check` part compiles `gritlint` when the files that define it are unchanged.
- R14. All `turbo-` entries together stay within KTD3's 4 GB budget once each `check` part keeps its own entry.

**Agent surface**

- R13. Each `check` part's step summary lists cached and total tasks, the missed tasks, the slowest tasks by duration, and a reason code; its Turbo run summaries upload as an artifact. Raw logs stay in artifacts.

### Key Decisions

- **Each shard builds its inputs from the Turbo cache; no build artifact is shared.** (session-settled: user-directed — chosen over one build job shared through `actions/upload-artifact`: that route puts a second setup plus upload and download, about 1.8 minutes, in series on every run, projects 10.3 minutes cold, and saves only runner-minutes, which are free on this public repository.) Governs R1, R3, R10.
- **Shards are balanced by a committed duration manifest packed longest-first, not by Vitest's `--shard`.** (session-settled: user-directed — the operator's ruling sets the assignment check and its reason code, which is the sign-off GATE1 requires.) `--shard` splits by file count and can put both 6-minute files on one shard. A committed manifest gives the same assignment for a given commit, so a shard can be re-run locally. The default shard excludes the other shards' lists instead of listing its own, so a stale manifest costs balance, never coverage, and the assignment check catches a file placed in zero shards or two. Governs R5, R6.
- **`compile-error-reuse` and `incremental-reuse` are split by scenario group before sharding.** Whole files cap a shard at 6.8 minutes. The test-code cut is about 5%, and the engine cut is a product change still unsized (Q1). Governs R7.
- **α-Conversion gets cheaper runs, not fewer.** The lib load per `Project` is the cost, so the rename must stop paying it on every run. Governs R8.
- **Three test shards.** At three, the balance reaches its floor (`vm-parity`, 4.5 minutes), and the parent plan's contention cap (KTD10, at most 3) holds. Governs R1.
- **Main's Turbo cache is saved after a red Gate.** This replaces KTD3's "only when the Gate passed": Turbo already refuses to cache a failed task, so a red save stores only work that succeeded. Governs R11.
- **`gritlint` comes from U2's flake-tool cache (KTD6), not a parallel `lint:conventions` job.** The cache also removes the build from runner time. A PR that changes `flake.lock`, `flake.nix`, or `nix/**` pays the 2.9 minutes once. Governs R12.

### Acceptance Examples

- AE1. Covers R9. **Given** a branch commit that plants a failing assertion in one shard's file, **when** CI runs, **then** that shard fails, the aggregate `check` fails naming the shard, and the other shards report success.
- AE2. Covers R6. **Given** a new `stryker-js` test file absent from the manifest, **when** CI runs, **then** it runs in the default shard and in no other, and the summed per-shard test count still equals the unsharded count. **Given** an assignment that drops or duplicates a file, **then** `check` fails with the assignment reason code naming that file.
- AE3. Covers R10. **Given** a warm run on a PR that changes only `stryker-js` sources, **when** the shards build, **then** each shard's summary shows its upstream build tasks as hits with the same hashes the non-test part reports.
- AE4. Covers R11. **Given** a main push whose Gate fails on one test task, **when** the next PR off that commit runs, **then** it restores the base commit's entry and misses only the failed task, the tasks whose inputs the PR changed, and their dependents.

### Projection

[INFERENCE: build closure and the non-test part are estimates; R3 measures them.]

| Path, minutes                                                                                                                       |  Cold |  Warm |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----: | ----: |
| Shard: setup 1.2, build closure, tests 4.5                                                                                          |   8.2 |   6.3 |
| Non-test part: setup, `format:check`, cached `gritlint`, lint, tsgo, typecheck, other tests with `e2e-core#test` at about 3 minutes |   8.2 | ≤ 4.5 |
| Aggregate `check` job                                                                                                               |   0.3 |   0.3 |
| `check`, first job start to last job end                                                                                            | ≈ 8.5 | ≈ 6.6 |

<!-- ce-section: work-relationships -->

### How This Work Fits Together

This plan covers `check`'s critical path on PRs that change `stryker-js`. The rest of CI's wall clock is the parent plan's, as currently understood rather than as a committed roadmap.

- `docs/plans/2026-10-10-0702-perf-ci-wall-clock-plan.md` U6 is the unit this plan refines; its KTD10 part layout, aggregate job, and per-part cache entries stand, with the balancing and the shard count set here.
  - Depends on U1 (merged as #279) for base-commit restore and `job-report`.
  - Depends on U2 for the `gritlint` cache that R12 needs.
  - Shares `ci.yml` with #291 (U4) and with #266's checker-parity jobs; whichever lands second merges main.
- R2's whole-workflow target depends on #291 and U3–U5 bringing every e2e leg under 10 minutes.
- Q1, the engine's per-run fixed cost, can proceed independently as a product change; it would shorten every engine-driven suite, these shards included.

### Scope Boundaries

- The e2e legs, Export telemetry, and the fixture bake (#291, U3–U5).
- Checker-parity jobs (#266) and everything in `mutation.yml` and `kill-matrix.yml`.
- The engine's per-run fixed cost (Q1); this plan shards around it.
- `vm-parity.differential` stays one scenario; its 240 s is the accepted shard floor.
- `@systemfsoftware/vitest`'s leaked-state re-run stays on every test.
- No permanent test is added. Moved scenarios keep their files' existing layer, and AE1's planted failure is reverted before the PR is ready. Coverage of the split is proved by the assignment check and by test counts on real runs.
- No bigger runners, raised timeouts, skipped or quarantined tests, `continue-on-error`, optional checks, self-hosted runners, cloud credentials, or new third-party actions or executables.

### Outstanding Questions

**Deferred to Planning**

- Q1. Where an engine run's fixed 4–8 s goes once the checker answers instantly: trace one `compile-error-reuse` run with the engine's spans and size a product-side cut.
- Q2. How the duration manifest is refreshed, and from which artifact (R13's uploaded run summaries or Vitest's JSON reporter on main), so a stale manifest costs balance and never coverage.
- Q3. Which hashing mechanism R10 uses: an environment variable declared only in `stryker-js#test`'s `env`, or a build invocation that runs before the sharded test invocation. Arguments after `--` enter the hash of every task in that invocation on Turbo 2.10, builds included, so they are not an option.
- Q4. Which cheaper-run change R8 uses, `skipLoadingLibFiles` per `Project` or one `Project` reused across runs, verified by identical renamed text across CI's seeds.
- Q5. How the parts' entries meet R14: whether each shard's pruned entry holds only its own test task plus its build closure, or whether shards restore the non-test part's entry and save only their test task.

### Sources / Research

- Runs: [38105648999](https://github.com/systemfsoftware/stryker-js-effect/actions/runs/38105648999) (job 114370536940) and [38108376853](https://github.com/systemfsoftware/stryker-js-effect/actions/runs/38108376853) (job 114378635195), plus the last 40 CI `check` jobs for the cached-task counts.
- Workflow and config: `.github/workflows/ci.yml` (Gate verdict and save rule), `turbo.json`, root `package.json` `check:ci` and `gate:tasks`, `packages/stryker-js/vitest.config.ts`.
- Tests read: `packages/stryker-js/tests/compile-error-reuse.integration.test.ts`, `packages/stryker-js/tests/__fixtures__/program-digesting-checker/worker.mjs`, `test/e2e-core/tests/analyzer.differential.test.ts`.
- Turbo failed-task caching: scratch repository with one passing and one failing task, Turbo 2.10.12.
- House test runner: `@systemfsoftware/vitest` README, "Leaked state" and "Concurrency and shuffle".
