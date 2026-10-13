---
title: "fix(stryker-js): sandbox cleanup never removes or blocks another run's sandbox"
type: fix
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
supersedes: docs/plans/2026-10-13-0417-fix-sandbox-cleanup-race-plan.md
execution: code
---

# fix(stryker-js): sandbox cleanup never removes or blocks another run's sandbox

## Goal Capsule

- **Objective:** Stryker runs that share one `tempDirName` directory, started or finished at overlapping times, each keep a working sandbox for their whole run, and the shared directory is gone once the last of them has cleaned up.
- **Product authority:** Stream H intent of 2026-10-12, and the root house law of 2026-10-12 22:08 (an integration test drives the real product through its published surface on a real project and asserts only user-observable outcomes; injected ports and engine internals are not integration tests). The root accepted the diagnosis after checking main: `packages/stryker-js/src/Sandbox.service.ts:32-41` reads the shared parent, then calls `fs.remove(parent, { recursive: true, force: true })`.
- **Means:** cleanup removes the shared parent through an atomic remove-if-empty capability added to `Engine.EnginePorts` (KTD1, KTD2), and acquisition retries the parent-then-sandbox pair when the parent vanishes (KTD3).
- **Open blockers:** none. KTD1 makes `@systemfsoftware/stryker-js` a major release. The root may overrule it with the rejected alternative recorded there.
- **Stop conditions:** stop and report if the regression test cannot be made to fail against main's `Sandbox.service.ts`, if the fix needs a change to `ci.yml`, e2e fixtures or `turbo.json`, or if a package outside `packages/stryker-js` and `packages/stryker-js-cli-contract` has to change.
- **Execution profile:** `ce-work` on branch `stryker/sandbox-cleanup-race`, cut from main `ee7038a5c`. One PR off main, opened unmerged. The root merges.

## Product Contract

### Summary

The sandbox service stops treating "the parent was empty when I looked" as permission to delete everything under it later. A run's cleanup removes its own sandbox and removes the shared parent only if it is still empty at the moment of removal. A run that is creating its sandbox survives another run removing the empty parent under it.

### Problem Frame

Every run puts its sandbox under `path.resolve(options.tempDirName)` (`Sandbox.service.ts:63`), and the default `.stryker-tmp` resolves against the process working directory, so concurrent runs from one directory share a parent. Concurrency is ordinary here: vitest runs several integration files at once in `packages/stryker-js`, sharded CI runs, and users run Stryker in parallel. Main's own CI hit it as a `LeakedState` report on `compile-error-reuse.integration.test.ts` (run 38288780734, PR #277). Two test setups already avoid it with a per-workspace `tempDirName` (`tests/readmit-subsumed.integration.test.ts:127`, `tests/__fixtures__/check-cost-workspace.fixture.ts:134,164`), which hides the product bug rather than fixing it.

Release (`removeTempDirectory`, `:43-55`) and acquisition (`makeTemporaryDirectory`, `:57-82`) are each several filesystem steps with no coordination. The interleavings that break a run:

| Mode | Interleaving                                                                                                     | Effect on main                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| F1   | B creates the parent (`:64`); A's cleanup finds it empty and removes it; B creates its sandbox inside it (`:67`) | B's acquisition fails with NotFound, so its prepare stage fails. Observed in CI and reproduced locally.      |
| F2   | A reads the parent as empty (`:36`); B creates its sandbox; A removes the parent recursively (`:38`)             | B's live sandbox is deleted under it.                                                                        |
| F3   | A sees the parent exists (`:50`); B's cleanup removes it; A reads it (`:36`)                                     | A's read fails with NotFound, and the finalizer's `Effect.orDie` (`:78`) turns a finished run into a defect. |

F1 is proven. F2 and F3 follow from the code but have not been observed; each counts only once a test reproduces it on main (R6).

### Requirements

**Isolation between runs**

- R1. A run's cleanup never removes, empties or modifies a sandbox directory that another run created.
- R2. A run's sandbox acquisition succeeds even when another run removes the empty shared parent at any point during that acquisition.
- R3. A run's cleanup succeeds even when another run has already removed the shared parent at any point during that cleanup.

**Cleanup that stays**

- R4. When a run cleans up and no other entry remains in the shared parent, the parent is removed, as on main today. When the shared path is not a directory — a plain file, or a symlink — the removal leaves it in place and the run still finishes, deliberately: main's `fs.remove(parent, { recursive: true, force: true })` deleted such a path, and the `rmdir`-based port stops doing so, matching the `EmptyDirectoryShape.removeIfEmpty` doc.
- R5. `cleanTempDir` keeps its meaning: whether a run removes its own sandbox is decided exactly as `keep-temp-dir.workflow.ts` decides it now.

**Proof**

- R6. A durable regression test reproduces F1 against main's `Sandbox.service.ts` on every run and passes after the fix. F2 and F3 are reproduced on main where real runs can reach them without a scheduler (KTD4); the rate is recorded, not claimed as deterministic.
- R7. The test judges outcomes on the real filesystem (which directories exist, whether acquisition and cleanup succeeded), not the order in which calls were made.

### Acceptance Examples

- AE1. Covers R2. Run B has created the shared parent and run A's cleanup removes it before B creates its sandbox: B still gets a sandbox directory that exists and that it can write to.
- AE2. Covers R1. Run A has read the shared parent as empty and run B then creates its sandbox: after A's cleanup ends, B's sandbox still exists with its contents.
- AE3. Covers R3. Runs A and B clean up at the same time and B removes the parent first: A's cleanup ends without error.
- AE4. Covers R4. A single run cleans up with `cleanTempDir: 'always'`: neither its sandbox nor the shared parent remains.
- AE5. Covers R4. A run cleans up while another run's sandbox exists: the parent and the other sandbox remain.

### Scope Boundaries

- Not changing where sandboxes live. A per-process parent, or resolving `tempDirName` against something other than the working directory, changes user-visible paths and is out of scope.
- Not touching the two per-workspace `tempDirName` workarounds in tests. They stay correct after the fix, and removing them is separate work.
- No change to the fixture bake, e2e limits, `ci.yml`, or Turbo task scope, cache wiring or task graph.

## Planning Contract

### Key Technical Decisions

- **KTD1. A new port, `EmptyDirectory`, joins `Engine.EnginePorts`; it is not an inline Node call in the service.** The Effect `FileSystem` port cannot remove a directory only when it is empty: `remove` calls `fs.rm`, which refuses a directory without `recursive` (`ERR_FS_EISDIR`, probed in Bun 1.4.3 and in the shipped `@effect/platform-node-shared` 4.0.0, `NodeFileSystem.js:117-124`). A `*.service.ts` must import no driver (pack: cell-architecture, `service-and-layer-boundaries.md`, rule 1 table and the adapter-module paragraph). The Node implementation therefore lives in the adapter module `node-platform.ts`, and the contract lives in a pure `empty-directory.service.ts`. This is #272's pattern for `SourceParser` (`251a511f0`). Widening `EnginePorts` breaks any consumer that builds its own ports layer, so the changeset is a major bump, as #272's was. Rejected alternative: `globalThis.process.getBuiltinModule('node:fs/promises').rmdir` inside `Sandbox.service.ts`, as `plugin-loader.service.ts:398,415` does. That needs no API change but puts a driver call in a service contract. Also rejected: a lock directory around acquisition and removal. A run killed while holding the lock blocks every later run.
- **KTD2. `EmptyDirectory.removeIfEmpty` is POSIX `rmdir`, and a non-empty or missing directory is a normal outcome, not an error.** `rmdir` fails with `ENOTEMPTY` or `EEXIST` when the directory has entries (opengroup `rmdir`, https://pubs.opengroup.org/onlinepubs/7990989775/xsh/rmdir.html), and with `ENOTDIR` when the shared path is not a directory — a plain file or a symlink — so a removal can never take a sibling's sandbox with it (R1), and such a path is left in place instead of deleted as main did (R4). `ENOENT` means another run already removed it. All four are reported as `Kept`/`Absent` outcomes, which keeps the finalizer's `Effect.orDie` (`Sandbox.service.ts:78`) from turning another run's cleanup into this run's defect (R3). Any other errno is a `PlatformError`, as on main today. The errno-to-outcome classification is a decision, so it is a `Workflow.make` in a `*.workflow.ts` that the mutation config covers. The adapter calls it as `node-platform.ts:79` calls `classifyWorkerExit` (pack: cell-architecture, `service-and-layer-boundaries.md:61,248`). Release becomes: remove own sandbox, then `removeIfEmpty(parent)`, with no `exists` or `readDirectory` in between (R4).
- **KTD3. Acquisition retries "create parent, make sandbox" only when the sandbox call reports the parent `NotFound`, at most 16 attempts.** Each lost attempt uses up one rival run's single pending removal of the empty parent: a run removes the parent at most once, after its own sandbox is gone, and only if the parent is empty. Losses are therefore bounded by the number of runs sharing this `tempDirName` that finish during this run's acquisition. 16 attempts cover 15 such runs finishing at once. Beyond that, and for a non-Stryker process that keeps removing the parent, acquisition surfaces today's `NotFound` instead of spinning. That residual is the accepted reading of R2, whose "another run" this bound discharges. The bound is a named constant beside the schedule, with that reason.
- **KTD4. The regression test races real runs against a rival acting on the real directory on disk, not a scheduler over injected ports.** The 2026-10-12 harness held each run before its k-th filesystem call through a ports layer it built; the house law rules that out. `tests/sandbox-cleanup-race.integration.test.ts` now runs `Engine.strykerCell` with `Engine.nodePlatformLayer` four times on one real project, while a rival fiber removes the shared directory with `rmdir` whenever it finds it empty: from the start (F1), or once the run holds a sandbox (F2/F3). It asserts that every run succeeds and no shared directory is left; the from-the-start row also asserts the rival removed the empty directory before it first held an entry (inside a run's create-directory, make-sandbox window), so that row is green only when the acquisition retry fired. The after-acquisition row asserts nothing about rival removals, because its rival can only win the instant inside a run's own cleanup. Two more scenarios drive real runs too (KTD5): several runs at once while another run keeps adding a file to the shared directory and checking it is still there (every run succeeds, no file lost), and one run whose shared directory already holds another run's file (the run succeeds, removes its own sandbox, and leaves the directory holding only that file). Cost: F1 fails on main on every run; the after-acquisition row failed on main in 2 of 5 runs (2026-10-13), so F2/F3 are reproduced, not pinned. A deterministic F2/F3 proof needs the scheduler the house law forbids; root decides whether that residual stands.
- **KTD5. The other run is represented by what it does to the directory on disk, and the port stays out of the published API.** Root's review of `67a640c68` found the test emulating another run's cleanup through `Engine.EmptyDirectory.removeIfEmpty`, an export added for the test. Two routes were weighed. (a) A second real `Engine.strykerCell` run as the other party: the concurrent-runs scenario does this (two runs at once), and on main `2083ba43a` it was red in 1 of 3 file runs, because two whole runs rarely land one's cleanup inside the other's create-directory, make-sandbox window. It can never assert that the acquisition retry fired. (b) A rival that does only what the other process does to the shared directory, plain `node:fs/promises` `rmdir` of the empty parent in a loop: the outline's rows, red on main in 3 of 3 file runs for both rows, and the from-the-start row asserts the removal landed inside an acquisition window. Both stay: (b) is the race proof, (a) is the concurrent-runs evidence; neither imports anything but `Engine.strykerCell` and `Engine.nodePlatformLayer`. The two scenarios that called the port directly are removed: the remove-if-empty churn (its claim is the concurrent-runs scenario's, through real runs, and it could never fail on main, where the export does not exist), and the five-target scenario (its holding target becomes a real-run scenario, which main also passes, because main keeps a directory it sees non-empty, so it guards R1 rather than reproducing a defect; the empty and absent targets are the outline's `parentLeft: false` and its rival's removals; a plain-file `tempDirName` fails acquisition on main and on the branch alike; a symlinked `tempDirName` finds no tests in the dry run, on main as on the branch (`DryRunCommand {"testCount":0}` → `DryRunError`), so no real run reaches its cleanup; `ENOTDIR` → kept is therefore graded by no test, see U2). `Engine.EmptyDirectory`, `EmptyDirectoryShape` and `Engine.nodeEmptyDirectoryLayer` are no longer exported from `src/Engine/mod.ts`. Nothing outside tests named them in code: at `67a640c68`, `git grep -- '*.ts'` finds `Engine.EmptyDirectory` only in the race test, and `nodeEmptyDirectoryLayer` only at `node-platform.ts:182,211`, where `makeNodePlatformLayer` provides it (now a module-local `const`), and at its own re-export, `src/Engine/mod.ts:4`. The only prose that named them was this PR's changeset, rewritten here. With both removed, `src` compiles and `api:check` reports only the two names leaving `Engine` (no `ae-forgotten-export`; `api-extractor.json:29-30` makes that an error, and the report lists namespace members only). Cost: `Engine.EnginePorts` still contains the service, so a consumer that assembles its ports from separate layers can no longer name it and must build them from `Engine.nodePlatformLayer`; no in-repo consumer does (`test/checker-parity/src/main.ts:504` and the vitest-runner tests provide `Engine.nodePlatformLayer` whole). Other ports keep their published tags (`GitDiff`, `SourceParser`, `Worker.WorkerLauncher`), and none publishes a separate Node layer.

### Sequencing

U2 (port and classification workflow) lands first. It changes no behavior, because main's `Sandbox.service.ts` never calls the port. U1 (the test) is then run red against main's `Sandbox.service.ts`: the outline's rows need only `Engine.strykerCell`, so they run on main unchanged. Then U3 (release and acquisition) and U4 (changeset and API report).

## Implementation Units

### U1. Race regression feature

- **Goal:** R6, R7; covers AE1, AE4, AE5 and R1 through real runs (KTD5).
- **Files:** `packages/stryker-js/tests/sandbox-cleanup-race.integration.test.ts` (new).
- **Approach:** per KTD4. Runs use `cleanTempDir: 'always'`, `incremental: false`, `reporters: []`, `checkers: []`, `dryRunOnly: true`, `concurrency: 1` and a passing test file on a fresh project; the working directory is set to the project root around the runs and restored after.
- **Test scenarios:** a scenario outline with two rival rows (from the start; after the run holds a sandbox) checking every run succeeded and no shared directory is left, and in the from-the-start row that the rival removed the directory inside an acquisition window; real runs racing a rival that keeps a sentinel file in the shared directory (no sentinel lost); one real run over a shared directory that already holds another run's file (the file and the directory stay, the sandbox goes).
- **Verification:** against main's `Sandbox.service.ts` (main `251201755`), the from-the-start row fails with all four runs `failed`; the after-acquisition row fails in some runs. On main `2083ba43a` (2026-10-13, test file copied unchanged) both outline rows were red in 3 of 3 file runs and the concurrent-runs scenario in 1 of 3; the holding scenario passes on main (KTD5). On the branch all four scenarios pass on repeated runs.

### U2. `EmptyDirectory` port, its Node adapter and its classification workflow

- **Goal:** KTD1, KTD2.
- **Files:** `packages/stryker-js/src/empty-directory.service.ts` (new: `Context.Service`, its shape, and the outcome type), `src/classify-empty-directory-removal.workflow.ts` (new: errno code to `Kept`/`Absent`/`Failed`), `src/node-platform.ts` (Node layer, provided in `makeNodePlatformLayer`), `src/run/StageServices.service.ts` (add to `EnginePorts` and `StageServices`; the tag is not exported from `src/Engine/mod.ts`, per KTD5), and `src/empty-directory.schema.ts` (new: the removal rejection the adapter raises before classification).
- **Approach:** the adapter runs `rmdir` through `globalThis.process.getBuiltinModule('node:fs/promises')`, the repo's builtin access pattern (`import-closure.cell.ts:104`). It hands the rejection's errno code to the workflow, and turns a `Failed` decision into a `PlatformError` through `PlatformError.systemError`.
- **Test scenarios:** the service, adapter and workflow get no tests of their own (ADR-0001 `:59`); U1 grades them through real runs. A real run's cleanup reaches `ENOTEMPTY` → kept (the holding scenario) and `ENOENT` → absent (the rival rows). The workflow's property law was deleted at `6860528ba`'s CI. Its oracle was a known-answer table restating the mapping, and the `"__proto__"` draw that refuted it was an oracle defect: the object lookup reached `Object.prototype`, while the workflow's `S.Literals` match was correct. The project's property-test rule deletes such a law rather than reshaping it. `EEXIST` and `ENOTDIR` → kept are graded by no test: a plain-file `tempDirName` fails acquisition before cleanup, and a symlinked one finds no tests in the dry run.
- **Verification:** `tsc -b` and `tsc -p tsconfig.test.json --noEmit` clean in `packages/stryker-js`.

### U3. Release and acquisition in `Sandbox.service.ts`

- **Goal:** R1-R5 per KTD2 and KTD3.
- **Files:** `packages/stryker-js/src/Sandbox.service.ts`.
- **Approach:** release removes its own sandbox, then calls `EmptyDirectory.removeIfEmpty(parent)` under the existing `sandboxRemoveEmptyParent` span. The `exists` and `readDirectory` calls go. Acquisition wraps `makeDirectory(parent)` plus `makeTempDirectory` in one effect, retried per KTD3. The `keepTempDir` decision is untouched (R5).
- **Test scenarios:** U1, plus the existing `clean-temp-dir.integration.test.ts` six rows unchanged (R5).
- **Verification:** U1 green; `clean-temp-dir`, `sandbox-acquisition-telemetry` and `compile-error-reuse` integration files green.

### U4. Changeset and API report

- **Goal:** release note for the new port and the fix.
- **Files:** `.changeset/<name>.md` (major for `@systemfsoftware/stryker-js`, per KTD1), `packages/stryker-js/etc/stryker-js.api.md` (regenerated with `api:update`).
- **Approach:** written through the `author-changesets` skill.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js api:check` passes.

## Verification Contract

Local, targeted only (no mutation runs, no e2e):

- `packages/stryker-js`: `node_modules/.bin/tsc -b`, `node_modules/.bin/tsc -p tsconfig.test.json --noEmit`, `node_modules/.bin/oxlint .`, `pnpm lint:tsgo`, `pnpm api:check`, and `vitest run` on `tests/sandbox-cleanup-race.integration.test.ts`, `tests/clean-temp-dir.integration.test.ts`, `tests/sandbox-acquisition-telemetry.integration.test.ts` and `tests/compile-error-reuse.integration.test.ts`.
- Red-first proof: U1's outline run against main's `Sandbox.service.ts`, with the failing rows and their rates recorded.
- CI on the pushed head is watched once; the full suite runs there.

## Definition of Done

- R1-R7 hold, with U1 failing on main's `Sandbox.service.ts` for F1 on every run and for F2/F3 at the recorded rate, and passing after U3.
- Report-only `ce-code-review` has run, with the reviewer models that actually served named in the PR body and every finding dispositioned.
- No probe files, scratch scripts or abandoned code remain in the diff.
