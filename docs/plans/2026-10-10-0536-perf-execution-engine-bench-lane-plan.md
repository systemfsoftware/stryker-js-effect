---
title: Execution Engine Bench Lane - Plan
type: perf
date: 2026-10-10
supersedes: docs/plans/2026-10-10-0035-perf-execution-engine-bench-lane-plan.md
topic: execution-engine-bench-lane
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Execution Engine Bench Lane - Plan

## Goal Capsule

- **Objective:** Every pull request shows, per project, whether it made a mutation run faster or slower, phase by phase (prepare, instrument, check, dry run, mutant execution, reporting) as absolute time and as share of the run's total, measured on the same runner against its base and separated from runner noise, so that every later execution-engine optimisation has CI evidence for its gain and the stream can see which phase is worth optimising (the instrument share decides whether Stream F's native emitter goes ahead).
- **Means:** a report-only `bench` workflow that builds the PR's merge-base with its base branch and the PR head in one job, runs both interleaved over two committed corpora, and summarises each run's own NDJSON (KTD1, KTD4).
- **Product authority:** Stream G (execution engine) of the stryker-js-effect SOTA program. The supervisor rules on scope, and stream coordination goes through the supervisor. This plan covers the first pull request, the bench lane. The rest of Stream G appears below as context and is not active scope.
- **Authority order:** `CONSTITUTION.md` > `AGENTS.md` > this plan's Product Contract > its Planning Contract.
- **Stop conditions:** stop and ask the supervisor before adding any third-party dependency or executable, before editing `pnpm-workspace.yaml` overrides or the `stryker-published` input, and, when the measured job time on the PR head exceeds 20 minutes, report the measured breakdown before shrinking anything (KTD6).
- **Execution profile:** one stacked PR on `stryker/exec-bench-lane` off `main`; one implementer; no local mutation or bench runs (the CLI refuses them outside GitHub Actions, `packages/stryker-js/src/refuse-local-mutation.workflow.ts:40-42`).
- **Open blockers:** none. Supervisor ruling 1 (2026-10-09) approved the new workflow file under CONST-E9 and settled the signal rule, the workload digest, the job-time target, side A's base and the stream upload. Rulings of 2026-10-10 made PR 1 the stream's first priority, added `reporting` as its own phase, required per-project shares of total over full runs, and required one versioned JSON report from which the summary table and a single annotation line derive.

---

## Product Contract

### Summary

A CI lane on every pull request builds the PR's merge-base with its base branch and the PR head in one job, runs both interleaved over a committed cross-package slice and the enterprise-monorepo fixture, and publishes, per project, each phase's median, min, max, share of total and delta read from each run's own NDJSON. The result is one versioned JSON artifact; the job summary table and one `::notice`/`::error` line are rendered from it. The stream gains `check` and `reporting` phase durations so checker and reporter time are visible for the first time.

### Problem Frame

Stream G exists to make each mutant cost the fewest test executions that can kill it, in a warm runtime, without changing a verdict. Every optimisation in that stream claims a speed gain, and today nothing in CI can confirm one. No workflow under `.github/` measures phase wall-clock, writes a job summary or comments on a PR. `mutation.yml` does not run on pull requests, and it runs the released CLI rather than the PR's code.

The engine already records most of what a bench needs: `verdict.phaseDurations` carries prepare, instrument, dry-run and mutation-test (`packages/stryker-js-cli-contract/src/run-event.schema.ts:203-209`). Checker time has no phase, though. Checking starts inside the mutation-test phase (`packages/stryker-js/src/run/mutation-test.cell.ts:90-91`), runs group by group, and streams passed plans into execution concurrently (`packages/stryker-js/src/Checker/checker-pool.handle.ts:274-289`, `:369-397`). Its time reaches the stream only as `fixedOverheadMs` on mutants the checker itself decided (`packages/stryker-js/src/run/mutant-settlement.ts:69-73`). Stream H needs a citable check phase too.

GitHub-hosted runners vary from run to run, so a single PR run diffed against a stored main number cannot separate a 10% gain from noise.

### Key Decisions

- **Same-job interleaved A/B, with no stored baseline.** The PR's merge-base with its base branch (A) and the PR head (B) are built in the same job and run interleaved on the same runner. A stacked layer therefore measures only its own change. Governs R1, R2, R4. (session-settled: user-directed — chosen over a stored main baseline and over the `origin/main` tip as side A: cross-runner variance swamps small gains, and a stacked layer must not measure the layers below it.)
- **Signal means the two samples do not overlap.** A cell is signal only when every B run is below every A run (or every one above) and the median delta is at least 3% of A's median; everything else is noise. Governs R5. (session-settled: user-directed — chosen over "delta beyond A's range", which flagged about 17% of null cells.)
- **A pinned cross-package slice is the repo corpus.** The repo corpus is one committed slice that puts real work through the instrumenter, the TypeScript checker and the vitest runner, not all four dogfood projects. Governs R2, R3. (session-settled: user-directed — chosen over a single pinned project and over all four projects sharded: the job has to stay within 20 minutes on one runner, and the vitest-runner entry stays because it carries the mutant-execution signal.)
- **Report-only.** The lane publishes evidence and never fails a PR on a timing delta. The first gate in the stream is the verdict-parity job (PR 2), because a new gate needs explicit approval (GATE1). Governs R6.
- **`check` is measured as checker-busy wall-clock and overlaps mutation-test.** Checking interleaves with execution, so a sequential phase boundary would misattribute time. Phase durations therefore no longer sum to total run time. Governs R9.
- **Workspace builds on both sides, with the dogfood overrides untouched.** The bench measures engine code that has not been released, so it runs packed workspace builds the way the e2e lane does. `pnpm-workspace.yaml` overrides and the `stryker-published` input stay as they are (AGENTS.md Dogfood boundary). Governs R1.
- **Incremental reuse is off for every bench run.** Reuse would hide the work being measured. Governs R2.

### Requirements

**Comparison**

- R1. One CI job per pull request builds the PR's merge-base with its base branch and the PR head on the same runner, by the same mechanism, and runs both against the same corpus.
- R2. The job runs the two sides interleaved in the order A B B A B A A B, four runs per side, with incremental reuse disabled.
- R3. The repo corpus is a slice declared once in the repository, changed only by a reviewed edit, and chosen so that instrument, check, dry run and mutant execution all do real work. The plan states its file count, mutant count and expected job time, and every run re-reports each side's mutant and test counts from its own NDJSON.
- R4. The enterprise-monorepo e2e fixture is benched alongside the repo slice under the same A/B protocol. Every project (each repo-slice entry and the fixture) is reported on its own.

**Reporting**

- R5. For each project and phase (prepare, instrument, check, dry run, mutant execution, reporting, plus total), the lane reports the median, min, max and every sample of A and of B, each side's median share of the run's total, and the median delta. A cell is a signal only when the two four-run samples do not overlap at all and |median delta| is at least 3% of A's median; a signal is `improved` when B is faster and `regressed` when B is slower; every other measured cell is `no-signal`, and a cell lacking a value on either side is `not-measured`.
- R6. The lane writes one versioned JSON report (`schemaVersion`) holding everything in R5 plus the setup and outer run timings, uploads it as the `bench-report` artifact, and renders both the job summary table and exactly one workflow-command line from that file after decoding it back: `::error` when any cell regressed, otherwise `::notice` naming the improvements or stating that no cell is a signal. A timing delta never fails the job. The job fails only when it cannot produce a valid measurement, for example a run that errored or a stream that does not decode, and then the line is `::error title=Bench invalid`.
- R7. Every number comes from the NDJSON that the run itself wrote, decoded with the published stream schema. Nothing is read from logs, spans or wall-clock taken outside the run.
- R8. When a side's stream has no check or reporting duration (main before this PR lands), that cell reads as not measured and is never shown as zero; while reporting is unrecorded on a side, its mutant-execution time still includes reporting, so the mutant-execution row is not-measured too.
- R8a. When the two sides ran different workloads, the corpus is flagged "workload changed" and none of its cells is signal. The workload is the content of the `mutate` files, the content of the test files that cover the corpus's mutants in each run, and the Stryker, vitest and tsconfig files, package manifests and catalog versions the run loads.

**Stream contract**

- R9. The run's verdict line reports a `check` phase duration equal to the union of the wall-clock intervals in which any checker works, startup included, added without removing or renaming any existing phase, so Stream H can cite it.
- R9a. The run enters a `reporting` phase when mutant settlement ends and reporters start, streams it as a `phase` event, and reports its duration in the verdict line; mutant execution ends where reporting begins, and the five sequential phases sum to the run's elapsed time.
- R10. A run with no checker configured reports check as not run, distinguishable from a measured zero.

**Cost and verification**

- R11. The whole job (both builds, both sides, both corpora) stays within 20 minutes of wall-clock on one GitHub-hosted runner, and the plan states the estimate.
- R12. The PR's own head CI shows the lane running and its table populated. Tests added for the check phase and the table decision can fail on a plausible bug.

### Acceptance Examples

- AE1. **Covers R5.** Given A's mutant-execution runs of 61, 64, 62 and 63 s and B's of 55, 56, 54 and 57 s, the samples do not overlap and the median delta of −7 s is 11% of A's median of 62.5 s, so the cell is signal. Given B at 60, 63, 61 and 62 s, the samples overlap and the cell is noise. Given A at 100, 101, 102, 103 s and B at 98, 98.5, 99, 99.5 s, the samples do not overlap but the delta of −2.75 s is under 3% of 101.5 s, so the cell is noise.
- AE2. **Covers R8, R10.** Given main's stream has no `check` key and the PR's run has a checker, when the table renders, A's check cell reads "not measured" and B's shows its median. Given a run with no checker configured, the verdict line reports check as not run, not as 0 ms, and the repo corpus's check row labels that entry "not run" instead of adding it in silently.
- AE3. **Covers R6.** Given one B run exits with a stream that fails to decode, the job fails and names the run and the line. Given every run decodes and B is slower beyond the noise rule, the job passes and the table shows the regression.

### Scope Boundaries

- Verdict parity between A and B is PR 2, which runs in this same lane over the same runs. This PR compares no statuses.
- No stored baseline, artifact store, trend history or cross-run comparison.
- No change to `mutation.yml`, the dogfood overrides or the released-tarball input.
- No per-mutant timing columns. Per-mutant `cost` already sits on each `mutant` line for anyone drilling in.
- No local mutation or bench runs. Measurement exists only in CI.

---

<!-- ce-section: work-relationships -->

## How This Work Fits Together

This plan covers PR 1, the bench lane. The breakdown below is how the rest of Stream G is understood today, not a committed roadmap. Each later item is its own PR, stacked where it depends on an earlier one, and ships only when the bench shows a measured gain and the parity gate holds.

- PR 2, verdict-parity gate. Depends on PR 1, reusing its A/B runs. It fails a PR when any mutant's status differs between the main build and the PR build on the fixture corpus. Both sides are computed fresh in the same job and never recorded, which keeps it within E2E-2 and CONST-T10. Mutants are keyed by file, location, mutator and replacement, and status is compared, not killedBy or statusReason.
- PR 3, exact test selection. Can proceed independently of PR 2, but should land early. The vitest runner's test filter is an unanchored, file-agnostic name regex (`packages/stryker-js-vitest-runner/src/VitestRunner.service.ts:159-170`), so tests whose names merely contain a covering test's name also run. Selection becomes exact on file plus full name.
- Infection-filtered execution. Depends on PR 2, on Stream F emitting the switch-point records described below, and on the qualifying-mutator table. Non-infecting (mutant, test) pairs are skipped, and a mutant that no covering test infects is reported Survived with reason "never infected".
- Kill-likelihood file order. Depends on Stream B's VerdictStore port and on PR 2. Covering test files are ranked by kills per execution from verdict history for the same source file or mutator, cost-aware (likelihood over expected time), falling back to duration. Order inside a file stays source order.
- Cheaper isolated re-imports. Depends on PR 1 for evidence. It keeps Vitest's per-file isolation semantics exactly, carries no module state across files, and comes in three independent steps: (a) compiled-code caching so a fresh thread re-evaluates without re-parsing or re-compiling; (b) worker start from a snapshot that holds no user-module state; (c) re-evaluating only what a static mutant needs instead of retiring or reloading the runner, and only with a written losslessness argument. A step the bench shows no gain for is recorded as a stated skip.

---

## What Main Already Does

Inventory at origin/main `1e1de6d05`, checked against the code.

| Stream G item                                     | Status on main | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| perTest coverage default                          | Met            | `coverageAnalysis` defaults to `StrykerCoverageAnalysis` = `'perTest'` (`packages/stryker-js-plugin-interface/src/stryker-options.schema.ts:7`, `:70`, `:235`)                                                                                                                                                                                                                                                                                          |
| Per-test coverage recording                       | Met            | `stryCov_9fa48` writes `mutantCoverage.perTest[currentTestId]`, else `.static` (`packages/stryker-js-instrumenter/src/InstrumentHeader.ts:48-58`). The vitest dry run sets `currentTestId` per test and publishes coverage in `afterAll` (`packages/stryker-js-vitest-runner/sandbox/stryker-setup.ts:56-65`)                                                                                                                                           |
| Each mutant runs only its covering tests (item 2) | Partly met     | The planner builds `testFilter` from `testsByMutantId` (`packages/stryker-js/src/plan-mutant-tests.workflow.ts:263-277`, `:310-328`). Uncovered non-static mutants become NoCoverage (`:281-288`). Static mutants run the whole suite with a reload unless `ignoreStatic` is set (`:290-308`, `:143-151`). The gap is that the runner's name regex over-selects (`VitestRunner.service.ts:159-170`), which is PR 3                                      |
| First-kill stop (item 4)                          | Met            | Mutant runs use vitest `bail = 1` unless `disableBail`, and the dry run uses 0 (`packages/stryker-js-vitest-runner/src/VitestSession.service.ts:143-144`, `VitestRuntime.handle.ts:127-140`). `kill-first-ordering.integration.test.ts:158`, `:179` and `:226` assert `executedTests == [KILLER]`                                                                                                                                                       |
| Kill-likelihood ordering (item 4)                 | Partly met     | Prior killer of this exact mutant first, then ascending duration (`plan-mutant-tests.workflow.ts:226-261`). The prior killer comes only from the incremental report (`packages/stryker-js/src/run/incremental-reuse.cell.ts:154-197`). Order is applied per file only (`packages/stryker-js-vitest-runner/src/sort-test-files.workflow.ts`). There is no history-derived score                                                                          |
| Infection filtering (item 3)                      | Not met        | No switch point evaluates a mutant during the dry run. The SOTA plan deferred it (`docs/plans/2026-09-29-0427-feat-state-of-the-art-mutation-testing-plan.md`)                                                                                                                                                                                                                                                                                          |
| Warm runtime (item 5)                             | Partly met     | The node compile cache is enabled and inherited by workers (`packages/stryker-js/src/bin/enable-compile-cache.ts`, `bin/main.ts:140-144`). The Vite transform cache `fsModuleCache` is on by default (`VitestRuntime.blueprint.ts:274-281`). The standby pool pre-boots the next thread, but each test file gets a fresh thread that is stopped afterwards (`StandbyThreadsPool.handle.ts:149-160`). There is no `vm.Script` cachedData and no snapshot |
| Runner reuse                                      | Exists         | Child-process runners persist across mutants. `maxTestRunnerReuse` (default 0) and `withEnvironmentReload` govern retirement (`packages/stryker-js/src/pooled-test-runner.handle.ts:204-288`)                                                                                                                                                                                                                                                           |
| Per-phase timing in NDJSON (item 1)               | Partly met     | `phase` lines carry a cumulative `elapsedMs` mark (`run-event.schema.ts:11`, `:27-30`). `verdict.phaseDurations` holds four phases (`:203-209`, `:236`; `packages/stryker-js/src/phase-durations.ts:42-52`). There is no `check`                                                                                                                                                                                                                        |
| Bench lane in CI (item 1)                         | Not met        | No bench job, step summary or PR comment anywhere in `.github/`. `mutation.yml` runs on push, schedule and dispatch, never on pull requests                                                                                                                                                                                                                                                                                                             |
| Lossless verdict check vs main (item 6)           | Not met        | `stryker compare` exists (`packages/stryker-js/src/compare-verdicts.workflow.ts`) but no workflow invokes it. The e2e annotation oracle compares status totals, not per-mutant statuses (`test/e2e/tests/__fixtures__/annotation-oracle.fixture.ts:131-183`)                                                                                                                                                                                            |

V8 `Profiler.takePreciseCoverage` adds nothing here, so it is not adopted. It reports function and block execution counts per script, while the instrumenter already counts every mutant site per test (`InstrumentHeader.ts:48-58`). Mapping V8 block ranges back to mutant sites would reproduce that coarser and depend on V8's block boundaries matching mutation sites, which they do not for expression-level mutants.

---

## Stream Decisions Carried Forward

These decisions shape later PRs. They are recorded here so those PRs and Streams F and B can cite them.

### Infection: the losslessness argument

A (mutant, test) pair may be skipped when the mutant is a qualifying pure expression and its value equals the original's at every evaluation the test performs. The argument runs by induction over the test's execution:

1. The mutated program and the original run the same instructions until the first evaluation of the mutated expression.
2. At that point the mutant's value is computed from operand values the original has already produced, and computing it runs no user code. So the mutated program is in the same state as the original, with the same value under `Object.is`.
3. Steps 1 and 2 repeat at every later evaluation, so the whole execution is identical, and so is the test outcome. The dry run passed, so the mutant survives that test.

The premise matches the one perTest coverage already relies on: the test is deterministic. Equality uses `Object.is`, so `NaN` equals `NaN` and `-0` differs from `+0`. The parity gate (PR 2) is the empirical check on this argument.

### Infection recording must not perturb the baseline

- Probes run only in the dry run. A mutant run evaluates exactly what it evaluates today.
- A probe never changes the original value, never throws out of the switch point and never counts as a mutant hit.
- A probe that throws, fails its runtime guard or meets a non-primitive operand marks the pair infected.
- A probe that would recurse or run long is bounded the same way, and hitting the bound marks the pair infected.
- The recording dry run's verdicts, test results and coverage must equal those of a plain dry run on the fixture corpus. A CI check proves it before infection filtering ships.

### Switch-point contract for Stream F

- **At instrument time:** the emitter marks each mutant as probed or not probed, explicitly. Absence of an infection record means "never infected" only for probed mutants (pack: schema-laws, tagged-unions-over-state-by-presence.md).
- **At each evaluation of a probed site during the dry run:** the original is evaluated once, operand values are reused, and each probed mutant's value is computed under its guard. When the values differ, the guard fails or the computation throws, infection is recorded against the current test id, or against the static bucket at load time.
- **Static-bucket infection:** it counts as infecting every test, since static mutants already run the whole suite.
- **What switch points do not record:** values, or anything for unprobed mutants. Unprobed mutants run exactly as today.

### Qualifying mutators (draft)

Classes:

- **Q**: pure by construction.
- **G**: pure under a runtime guard that operands are primitives; guard failure means infected.
- **S**: qualifies only when every subexpression the mutant adds or drops is statically side-effect-free.
- **Reach-equivalent**: every reach infects, so pruning gains nothing beyond coverage, and the mutant runs normally without a probe.
- **No**: runs normally.

| Mutator                                                                                       | Mutation                                  | Class            | Why                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ArithmeticOperator                                                                            | `a + b` → `a - b` etc.                    | G                | Operands are reused. Object operands would invoke `valueOf` or `toString`. A throw (BigInt mixing) means infected                |
| EqualityOperator `<`/`<=`/`>`/`>=`/`==`/`!=`                                                  | operator swap                             | G                | Relational and loose equality coerce objects. `NaN` comparisons can tie                                                          |
| EqualityOperator `===`↔`!==`                                                                  | operator swap                             | Reach-equivalent | Always the opposite value                                                                                                        |
| EqualityOperator sufficiency literal                                                          | comparison → `true`/`false`               | S, G             | The dropped comparison may coerce. Compare the boolean value                                                                     |
| LogicalOperator                                                                               | `&&`↔`\|\|`, `??`→`&&`                    | S                | The left operand is reused. The right operand is known only when the original evaluated it. Otherwise it must be statically pure |
| UnaryOperator                                                                                 | `+x`↔`-x`, `~x`→`x`                       | G                | Primitive operand. `+bigint` throws, which means infected                                                                        |
| AssignmentOperator arithmetic/bitwise                                                         | `+=`↔`-=` etc.                            | G                | Old target value and right-hand side are read once by the original. Compare the new values                                       |
| AssignmentOperator logical                                                                    | `&&=`, `\|\|=`, `??=`                     | S                | Whether the right-hand side is evaluated differs between the two                                                                 |
| OptionalChaining                                                                              | `a?.b` → `a.b`                            | Q                | Infected exactly when the base is nullish. Otherwise it is the same access the original already performed                        |
| ConditionalExpression                                                                         | test → `true`/`false`                     | S, G             | Compare `Boolean(test)` with the literal. The dropped test must be statically pure                                               |
| StringLiteral template with expressions                                                       | template → empty                          | S, G             | Interpolations are dropped and their `toString` may run user code                                                                |
| StringLiteral plain                                                                           | `'x'`→`''`, `''`→`'Stryker was here!'`    | Reach-equivalent | Always differs                                                                                                                   |
| BooleanLiteral                                                                                | `true`↔`false`, `!x`→`x`                  | Reach-equivalent | Always differs                                                                                                                   |
| UpdateOperator                                                                                | `x++`↔`x--`                               | Reach-equivalent | Writes state. Differs for every value except `NaN`. Runs normally                                                                |
| MethodExpression on intrinsic `String.prototype`/`Math` with primitive receiver and arguments | e.g. `startsWith`↔`endsWith`, `min`↔`max` | G (narrow)       | Runtime check that the receiver is primitive and the method is the unpatched intrinsic. Otherwise infected                       |
| MethodExpression otherwise                                                                    | method swap or drop                       | No               | Calls user code, callbacks or mutating array methods                                                                             |
| ArrayDeclaration, ObjectLiteral, ArrowFunction, Regex                                         | new value                                 | Reach-equivalent | A fresh object identity on every evaluation, and dropped elements may have side effects                                          |
| BlockStatement                                                                                | block → `{}`                              | No               | A statement, not an expression                                                                                                   |
| AtomicUpdateSplit, SynchronizationRemoval, FinalizerEscape                                    | Effect rewrites                           | No               | They build Effect descriptions. Behaviour differs only under interpretation                                                      |

### Kill order and warm runtime

- **Kill order:** test-file level only. Reordering tests inside a file is rejected as a verdict risk, because tests share `beforeAll` and module state. (session-settled: user-directed — chosen over intra-file reordering gated per file and over treating item 4 as met: shared file state makes reordering lossy.)
- **Warm runtime:** per-file isolation is kept exactly. Gains come only from caching compiled code, from a state-free start snapshot and from minimal static-mutant re-evaluation, each one bench-gated. (session-settled: user-directed — chosen over non-isolated warm module reuse and over deferring the design: `docs/plans/2026-09-25-0809-refactor-vm-runner-runs-vitest-plan.md` measured `isolate:false` diverging when `vi.mock` loses effect.)

---

## Dependencies / Assumptions

- Stream A is splitting the core package into contracts/ports, engine, drivers and edges, and no ADR for that split exists on main yet (only `docs/adr/0001-cell-architecture-module-taxonomy.md`). New stream-contract members land in `packages/stryker-js-cli-contract` (contracts). Engine timing lands beside the existing phase clock in `packages/stryker-js`, and the lane's NDJSON reader sits at the CI edge. Ports carry no driver imports (pack: cell-architecture, ports-separate-from-layers.md).
- Stream B's VerdictStore port is the only source of kill history for file ordering.
- Stream F owns emitting the switch-point records described above.
- CONST-E9: this lane is a new CI surface. `AGENTS.md` lists `.github/workflows/` as read-only; supervisor ruling 1 (2026-10-09) is the approval to add `.github/workflows/bench.yml` and, later, the parity job. No other workflow file changes. It is report-only, so it adds no gate (GATE1).

## Outstanding Questions

### Resolve Before Planning

- None. Planning resolved the slice and N (KTD5, KTD6), the enterprise placement (KTD3) and the `check` representation (KTD7). Supervisor ruling 1 settled the workflow approval, the signal rule, the workload digest, the job-time target, side A's base and the stream upload.

### Deferred to the Supervisor

- Q-ERR. With 28 cells and the per-cell rule of KTD6, an unchanged PR gets an `::error` regression line in up to about a third of runs (fewer, since cells are correlated). The supervisor ruled `::error` on any regressed cell. Keep that, or make the annotation's `::error` stricter than the table's cell verdict (for example, only a regressed `total` row, or a per-report correction of the 3% floor), while the table keeps every cell? Until ruled, the lane implements the ruling as given.

## Sources / Research

- `docs/plans/2026-09-29-0427-feat-state-of-the-art-mutation-testing-plan.md`: earlier SOTA plan. Infection pruning deferred, no bench lane planned.
- `docs/plans/2026-09-25-0809-refactor-vm-runner-runs-vitest-plan.md`: isolation measurements.
- `docs/solutions/test-failures/stream-schema-must-not-carry-json-rest-records.md`: stream members are closed structs.
- `docs/solutions/workflow-issues/mutation-lane-green-while-every-job-failed.md` and `docs/solutions/workflow-issues/matrix-legs-rename-the-required-status-check.md`: CI-lane gotchas.
- `CONSTITUTION.md`: CONST-T3, CONST-T9, CONST-T10, CONST-E7, CONST-E9.
- Tests feed real NDJSON through real decoding, with no mocks (pack: boundary-testing, no-mocks-on-internal-glue.md). External input is decoded, never cast (pack: cell-architecture, decode-never-cast.md).

---

## Planning Contract

### Key Technical Decisions

- KTD1. One report-only job on `pull_request`, in a new `.github/workflows/bench.yml`. It is not added to `ci.yml`, so no existing required status context moves (`docs/solutions/workflow-issues/matrix-legs-rename-the-required-status-check.md`), and its name never imitates `check`. It follows the `ci.yml` `check` skeleton (checkout, nix, pnpm and node 24, turbo cache), except that both sides' tarballs and installs go through the one KTD2 mechanism instead of the `released-tarballs` composite, which only serves the checkout root. `timeout-minutes: 40`.
- KTD2. Each side runs its own CLI and its own plugins, and both sides are built by one mechanism. Side B is the PR checkout; side A is a `git worktree` at `git merge-base HEAD origin/<base_ref>`, where `<base_ref>` is the PR's own base branch (`github.base_ref`), so a stacked layer measures only its own change. For each side the lane runs the same steps: restore that side's `.sfs-deps` from the cache key the `released-tarballs` composite uses (the side's own `flake.lock` pin), on a miss `nix build <side>#stryker-published` into the side's `.sfs-deps`, then `pnpm install --frozen-lockfile` and a turbo build of the corpus projects and the engine packages, sharing one turbo cache dir. Nix is installed once for the job, so neither side depends on it being present only for the other. Plugins never enter the CLI's import graph: the config names them by specifier or `file:` URL and the plugin loader resolves that at run time (`packages/stryker-js/src/plugin-loader.service.ts:433-440`). The dogfood configs resolve them with `installedPlugin` next to the config (`packages/toolchain/stryker-config/lib/base.js:41-43`), which lands on the released tarballs. So each bench config names the side's own built runner, checker and ignorer entrypoints by `file:` URL, and that URL is what decides which build runs. `pnpm-workspace.yaml` and `flake.lock` are never edited.
- KTD3. The enterprise fixture runs directly on the runner, not through the e2e harness. The harness needs KVM-backed microVMs, a Tempo probe and OTEL rewiring (`test/e2e/src/Harness/warm-sandbox.handle.ts`, `test/e2e/tests/__fixtures__/global-setup.ts`), and `ci.yml` has no udev step for `/dev/kvm`. Per side the bench builds the closure the way `packWorkspaceClosure` does (`test/e2e/src/Harness/fixture-cache.service.ts:456`: turbo build of the four entry packages, then `pnpm -r pack`), copies the fixture from side B's tree, resolves `catalog:` specs against that side's `pnpm-workspace.yaml`, and runs the two `npm install` steps of `test/e2e/tests/__fixtures__/bake-fixtures.sh` with the specs `installClosure` decides (`test/e2e-core/src/install-closure.workflow.ts`). It runs the lifecycle config `stryker.config.ts` unchanged, through the side's installed CLI.
- KTD4. Every timing comes from the run's terminal `verdict` line, decoded with side B's `RunEvent.RunEventWireLine` (`packages/stryker-js-cli-contract/src/run-event-wire.schema.ts`). Each run gets its own `--progressStreamFile`, its own `--incrementalFile` and `--full` (`packages/stryker-js/src/bin/cli-command.ts:81-101`), so reuse and the persisted dry run are off and runs cannot read each other's files. A run counts only when its stream holds exactly one decodable `verdict` line; a stream file that merely exists proves nothing (`docs/solutions/workflow-issues/mutation-lane-green-while-every-job-failed.md`). Exit codes are not the validity signal, because the dogfood configs break at score 100 (`packages/toolchain/stryker-config/lib/base.js:23`); the bench configs set `thresholds.break` to null so a healthy run exits 0, and a non-zero exit beside a valid verdict line is still reported. A side-A stream that B's contract cannot decode (a PR that breaks the stream) is an invalid run like any other: the job fails and names it. Each side's mutant count (from the verdict) and tests executed (the sum of `cost.testsExecuted` over its `mutant` lines) are printed per corpus, so the corpus size is re-checked on every run.
- KTD4a. Both sides must run the same workload, or the delta measures the workload. A run's workload digest covers only what can change the work: the content of its `mutate` files; the content of the test files that cover its mutants, taken from that run's own incremental report (the report's `coveredBy` test ids mapped to their test files; the stream carries no covering tests, and the supervisor chose the run's own report over a stream change); and the Stryker, vitest and tsconfig files, package manifests and the catalog versions those manifests name, as that run loads them. A corpus is `workload changed` unless every one of its runs, on both sides, has the same digest per entry; a `workload changed` corpus never marks `signal`. The enterprise fixture is copied from side B's tree, so its sources are identical by construction, and the same digest rule still applies to it.
- KTD5. The repo corpus is three files from three dogfood projects, declared once in `test/bench/corpus.json`. Counts come from main's `mutation-report-416` artifact (mutation run of 2026-10-09):

  | Project                                  | File                                          | Mutants | Test-executed | CompileError | Checker |
  | ---------------------------------------- | --------------------------------------------- | ------- | ------------- | ------------ | ------- |
  | `packages/stryker-js-vitest-runner`      | `src/interpret-vitest-mutant-run.workflow.ts` | 109     | 36            | 63           | yes     |
  | `packages/stryker-js-typescript-checker` | `src/classify-tce.workflow.ts`                | 49      | 12            | 27           | yes     |
  | `test/e2e-core`                          | `src/placement-closure.workflow.ts`           | 39      | 30            | 0            | none    |
  | Total                                    | 3 files                                       | 197     | 78            | 90           |         |

  Selection rule, recorded beside the declaration: every phase does real work (instrument; check through CompileErrors; dry run; mutant execution; reporting through each project's own reporters); no file had a `Timeout` verdict on main, since timeouts measure the timeout setting rather than the engine; one entry has no checker, so `not-run` is exercised on every run. `packages/stryker-js` is excluded: its dry run runs 1,099 tests and would dominate every repetition. Each entry is its own project in the report (R4); a repetition of a project is its one CLI run at one position.
- KTD6. N = 4 per side per project, in the order A B B A B A A B, which puts each side first in two of four pairs. Each position runs every project once for that side. Signal rule: a cell is a signal only when the two four-run samples do not overlap at all (every B below every A, or every B above) and |median B - median A| is at least 3% of A's median. Under the null (A and B exchangeable), complete separation happens in 2 of the C(8,4) = 70 equally likely orderings, so the per-cell false-signal rate is at most 2/70 ≈ 2.9%, half of it on each side (1/70 ≈ 1.4% false `regressed`); the 3% floor only lowers it. The report has 28 cells (seven rows including total, four projects). If they were independent, an unchanged PR would show 28 × 2/70 ≈ 0.8 false-signal cells on average, at least one in 1 - (68/70)^28 ≈ 56% of reports, and at least one false `regressed` (so a `::error` line) in 1 - (69/70)^28 ≈ 33%. The cells are positively correlated (total contains the other phases, and a project's phases share its runner moment), so the real rates are lower, but a lone signal cell is a lead to re-run, not proof; the rendered note says so. Estimated job time [INFERENCE, not measured, because no local runs are allowed]: setup 2-3 min; both sides' tarballs, installs, builds, packing and fixture installs 4-6 min; 8 positions of 55-120 s (the three repo entries at 40-90 s together, the enterprise run at 15-30 s), 7-16 min; 13-25 min in total. The target is at most 20 minutes. The report records each run's outer wall-clock and each setup step's time, so the first head run measures the breakdown. If it exceeds 20 minutes, the breakdown goes to the supervisor before anything shrinks. N stays 4 and the corpus stays as declared.
- KTD7. `check` and `reporting` are new members of `RunEvent.PhaseDurations`, each a tagged union: `CheckDuration` is `measured { ms }`, `not-run` (no checker configured) or `not-recorded`; `ReportingDuration` is `measured { ms }` or `not-recorded`. `not-recorded` is the decoding default when the key is absent (`withDecodingDefaultKey`, `repos/effect/packages/effect/src/Schema.ts:5724`); the CLI always writes both keys. Old streams (main before this PR, and stacked PRs whose merge-base predates it) decode as `not-recorded`, rendered "not measured" (R8). Each state is its own variant, never a nullable whose meaning depends on context (CONST-D4; pack: schema-laws, tagged-unions-over-state-by-presence.md). Both encoded keys are optional, so the contract-version law sees no newly required property (`packages/stryker-js-cli-contract/tests/__fixtures__/contract-compat.fixture.ts` flags only additions to `required` and dropped enum values), and old consumers drop the extra keys (Effect `onExcessProperty` defaults to ignore, `repos/effect/packages/effect/src/SchemaAST.ts:463`). `reporting` is also a new `RunPhase` value, entered when mutant settlement ends and reporters start, because it is a sequential boundary; `check` is not, because it overlaps. Adding an enum value widens `RunPhase`, which the law accepts. `StreamSchemaVersion` stays `6.0`.
- KTD8. `check` is the length of the union of checker-busy intervals: each checker's startup (`packages/stryker-js/src/Checker/checker-pool.blueprint.ts`, inside `acquire`) and each timed group check (`packages/stryker-js/src/Checker/checker-pool.handle.ts`, inside `checkedGroupsFor`). Both run paths acquire checkers through `acquireCheckers` (`packages/stryker-js/src/run/mutant-settlement.ts`), used by `mutation-test.cell.ts` and `deferrable-dry-run.cell.ts`, so recording at the pool covers both. Intervals go to `PhaseClock` (`packages/stryker-js/src/run/phase-clock.service.ts`), the single owner of phase timing. `CheckerBusyIntervalSchema` (`packages/stryker-js/src/phase-durations.schema.ts`) refuses `endMs < startMs`; `PhaseClock.recordCheckerBusy` clamps the two raw clock readings once, through `checkerBusyIntervalOf`, so no consumer clamps again. The duration decision is the `phaseDurations` workflow (`packages/stryker-js/src/phase-durations.workflow.ts`), inside the mutated population per ADR-0002. The five sequential phases sum to elapsed time.
- KTD9. Placement follows Stream A's expected split without waiting for it. Contract shapes live in `packages/stryker-js-cli-contract`; timing stays in the engine (`packages/stryker-js`). The lane's pure decisions (corpus decode, run reading, aggregation, signal classification, the report schema, table and annotation rendering) live in `test/e2e-core`, which already decodes `RunEventWireLine` (`test/e2e-core/src/decode-stream.workflow.ts`), imports contract packages only, and is mutated by the dogfood lane. The orchestrator is a new private workspace package `test/bench`, an Effect program run with node, mirroring the `test/e2e` / `test/e2e-core` shell-and-core split. It adds no third-party dependency: `effect` and `@effect/platform-node` are already catalog entries.
- KTD10. The pure catalog helpers move from `test/e2e/src/Harness/catalog-resolution.ts` into `test/e2e-core`, so the e2e harness and the bench share one implementation instead of a copy. `test/e2e/src/Harness/fixture-cache.service.ts:52-53` is the only importer.
- KTD11. One JSON report is the lane's only output of record. `BenchReport` (`test/e2e-core/src/bench-report.schema.ts`, `schemaVersion: '1.0'`) holds the base and head SHAs and one outcome: `summarized` (per project the rows of R5 with every sample and its share of total, from which median, min and max are derived so they cannot disagree; the verdict `improved | regressed | no-signal | not-measured`; the workload status `same | changed | unverified` and counts), `failed` (the invalid runs, each with a code, its exit code and a bounded stderr tail; a run past its per-run timeout is an invalid sample with code `timeout`), or `aborted` (a code, the reason and the next action, written for every setup or orchestration failure). The orchestrator encodes it, writes it, reads it back and decodes it, and only then renders the job-summary markdown and the single annotation line from the decoded value through the `renderBenchReport` workflow, so the outputs cannot disagree. `failed` and `aborted` emit `::error` and exit non-zero; an `unverified` workload never reports a speed signal. The annotation is `::error title=Bench regression::…` when any cell regressed, otherwise `::notice`.

### High-Level Technical Design

```mermaid
flowchart TD
  S[setup: checkout, released-tarballs, pnpm install] --> WA[worktree A at merge-base: install, build, pack]
  S --> WB[side B: build, pack]
  WA --> P[per side: bench configs for 3 repo entries; enterprise fixture copy + npm install]
  WB --> P
  P --> R[run A B B A B A A B, every project at each position, one stream file per run, --full]
  R --> D[decode each stream's verdict line with B's contract]
  D --> Q{every run valid?}
  Q -- no --> F[fail the job naming run and line]
  Q -- yes --> T[summarize per project: samples, median, min, max, share, delta, verdict, workload status]
  T --> J[write bench-report.json, read it back and decode it]
  J --> G[render GITHUB_STEP_SUMMARY table and one ::notice or ::error line; upload bench-report artifact]
  F --> J
```

### Sequencing

U1 before U2 (the engine writes the new member). U3 needs U1's types. U4 is independent. U6 needs U3 and U4. U5 needs U6. All units ship in this one PR so the lane runs on its own head (R12).

---

## Implementation Units

### U1. `check` in the stream contract

- **Goal:** the verdict line can carry checker time in all three states and reporting time, and `reporting` is a phase.
- **Requirements:** R8, R9, R9a, R10.
- **Files:** `packages/stryker-js-cli-contract/src/run-event.schema.ts`; `packages/stryker-js-cli-contract/src/RunEvent/mod.ts`; `packages/stryker-js-cli-contract/contract/stream.schema.json` (regenerated by `packages/stryker-js-cli-contract/scripts/contract-documents.ts`); `packages/stryker-js-cli-contract/tests/run-event-wire-line.integration.test.ts`; `packages/stryker-js-cli-contract/tests/contract-version-law.integration.test.ts` and its fixture (the law weighs a member added inside a nullable struct as an addition, not a removed union branch); a `.changeset/*.md`.
- **Approach:** KTD7.
- **Test scenarios:** a verdict line without `check` and `reporting` decodes both to `not-recorded`; `measured` reporting with `measured` and `not-run` check round-trips byte-stable; a negative or non-finite `ms` is refused; an unknown tag is refused; the version law accepts an optional member added inside a nullable struct at a patch intent and refuses a required one.
- **Verification:** `contract-documents.integration.test.ts` and `contract-version-law.integration.test.ts` pass with the regenerated document.

### U2. Checker-busy time in the engine

- **Goal:** every run reports `check` as the union of checker-busy intervals and `reporting` as its own sequential phase.
- **Requirements:** R9, R9a, R10.
- **Files:** `packages/stryker-js/src/phase-durations.ts`; `packages/stryker-js/src/phase-durations.schema.ts`; `packages/stryker-js/src/run/phase-clock.service.ts`; `packages/stryker-js/src/Checker/checker-pool.blueprint.ts`; `packages/stryker-js/src/Checker/checker-pool.handle.ts`; `packages/stryker-js/src/run/mutant-settlement.ts`; `packages/stryker-js/src/run/mutation-test.cell.ts`; `packages/stryker-js/src/__tests__/phase-durations.workflow.property.test.ts`; `packages/stryker-js/src/__tests__/checker-pool.workflow.property.test.ts`; `packages/stryker-js/tests/check-cost-record.integration.test.ts` and its fixture.
- **Approach:** KTD8. `PhaseClock` gains an interval recorder and a checkers-configured flag; the pool records startup and each timed group; `phaseDurationsOf` takes the recorded intervals and the flag. Every path that enters `mutation-test` enters `reporting` before the verdict, and `reporting`'s start is a required boundary.
- **Test scenarios:** properties - the union is at most the sum of the intervals and at least the longest one; it equals the sum for disjoint intervals; it is invariant under reordering, duplication and splitting an interval in two; no checker configured gives `not-run`; a configured checker always gives `measured`; the five sequential phases sum to elapsed time and reporting is measured whenever durations exist. Integration, on the existing checked and unchecked workspaces (`packages/stryker-js/tests/__fixtures__/check-cost-workspace.fixture.ts`): the checked run's verdict carries `measured` check with `ms > 0` and `measured` reporting, its `phase` events put `reporting` after `mutation-test`, and the unchecked run's carries `not-run`.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js test`.

### U3. Bench decisions in `test/e2e-core`

- **Goal:** pure, tested decisions that turn decoded runs into the versioned report, the table and the annotation line.
- **Requirements:** R3, R4, R5, R6, R7, R8, R8a.
- **Files:** new `test/e2e-core/src/bench-corpus.schema.ts`, `bench-run.schema.ts`, `bench-order.ts`, `read-bench-run.workflow.ts`, `covering-test-files.workflow.ts`, `bench-summary.schema.ts`, `summarize-bench.workflow.ts`, `bench-report.schema.ts`, `render-bench-summary.ts`, `render-bench-annotation.ts`, colocated `src/__tests__/*.property.test.ts`, `tests/bench-decisions.integration.test.ts`; `test/e2e-core/src/mod.ts`.
- **Approach:** the corpus schema decodes `test/bench/corpus.json`. A run is a tagged union: `measured` (phase durations from its verdict, mutant count, tests executed, workload digest, outer wall-clock, exit code) or `invalid` (key, reason, line number). A project is one (corpus, entry); a repetition is its run at one position. Per repetition, total is prepare + instrument + dry run + mutation-test + reporting (0 while not recorded); `check` overlaps and is not in total; a `not-run` check is 0 and labelled, never summed in silently; a `not-recorded` value makes that cell not measured, and a side without `reporting` also makes mutation-test not measured. Per phase and side: samples, median, min, max, median share of total. Verdict by the KTD6 rule: separated samples with |Δ| ≥ 3% of A's median are `improved` (B faster) or `regressed` (B slower); other measured cells are `no-signal`; a `workload changed` project never has a signal. Any `invalid` run turns the outcome into a failure listing every invalid run. KTD11 decides the report, the markdown and the annotation.
- **Test scenarios:** AE1, AE2 and AE3 as examples. Properties: swapping A and B negates Δ and swaps improved with regressed; identical sides give Δ 0 and `no-signal`; overlapping samples never signal; separated samples under the 3% floor never signal; adding a constant to every B run shifts Δ by exactly that constant; medians are independent of run order; shares lie in [0, 1]; a `not-recorded` value never renders as `0`; one differing digest makes the project `workload changed` with no signal; one invalid run anywhere yields a failure naming exactly the invalid runs. Report: the annotation is one line, `::error` exactly when some row regressed or the run set is invalid, and every project and phase it names has the same verdict in the markdown rendered from the same decoded report.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-e2e-core test`.

### U4. Shared catalog resolution

- **Goal:** one implementation of `catalog:` spec resolution for the e2e harness and the bench.
- **Requirements:** R4.
- **Files:** `test/e2e/src/Harness/catalog-resolution.ts` (moved into `test/e2e-core/src/`); the `MalformedFixtureManifest` and `UnresolvedCatalogSpec` classes it imports, moved from `test/e2e/src/Harness/harness-failure.schema.ts` into `test/e2e-core/src/` and re-imported there so the `HarnessFailure` union keeps them; `test/e2e/src/Harness/fixture-cache.service.ts`; `test/e2e-core/src/mod.ts`.
- **Approach:** KTD10. Move the module and the two failure classes it raises, re-point the importers, delete the old copies.
- **Test scenarios:** properties for the moved functions: `catalog:` resolves to the default catalog's version, `catalog:<name>` to the named catalog's, a missing entry is refused with `UnresolvedCatalogSpec`, a malformed manifest is refused with `MalformedFixtureManifest`, and non-catalog specs pass through unchanged.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-e2e-core test`; `pnpm typecheck`.

### U5. The `bench` workflow

- **Goal:** the lane runs on every PR, its table shows on the PR, its verdict line shows in the log, and its JSON report is downloadable.
- **Requirements:** R1, R6, R12.
- **Files:** `.github/workflows/bench.yml`.
- **Approach:** KTD1, KTD2. `pull_request` trigger; full-history checkout of the PR head SHA and a fetch of `origin/<base_ref>` (the merge-base needs both); `cachix/install-nix-action` once; per side a cache restore of the released tarballs under a key derived from that side's `flake.lock`; one step running the U6 orchestrator; an `actions/upload-artifact` step publishing `bench-report.json` as the `bench-report` artifact whenever the job was not cancelled; `timeout-minutes: 40`, so a run over the 20-minute target still finishes and reports its breakdown. Ruling 1 approved this file; no other workflow file changes.
- **Test scenarios:** none in-repo; the workflow is proven by running (R12).
- **Verification:** the PR head's `bench` job is green, its summary shows every project, side A's check and reporting "not measured", side B's measured, each side's counts and the workload status; the log ends with one `::notice` or `::error` line; the `bench-report` artifact decodes with `BenchReportJson`.

### U6. The bench orchestrator and corpus

- **Goal:** both sides built, every project run interleaved, every run decoded, the report written and rendered.
- **Requirements:** R1, R2, R3, R4, R6, R7, R8a, R11.
- **Files:** new package `test/bench/` (`package.json`, `tsconfig*.json`, `oxlint.config.ts`, `README.md`, `corpus.json`, `src/main.ts`, `src/prepared-side.ts`, `src/*.schema.ts`, `src/*.service.ts`); `pnpm-lock.yaml` importer entry.
- **Approach:** KTD2-KTD6, KTD11. Build both sides by the KTD2 steps. Per side, write one bench config per repo entry into that side's project directory, spreading the project's own `stryker.config.ts` and overriding `testRunner.plugin`, `checkers[].plugin` (keeping the project's own checker count), `ignorers`, `mutate` and `thresholds.break: null`; the project's own reporters stay, so `reporting` measures real work. Prepare the enterprise fixture (KTD3). Run in the KTD6 order with `--full` (no incremental reuse, so shares are not distorted), a unique `--progressStreamFile` and a unique `--incrementalFile`, inheriting the runner's `GITHUB_ACTIONS=true` and never setting it or `ALLOW_LOCAL_MUTATION`. Decode each stream, compute each run's KTD4a digest, call U3, write the KTD11 report, read it back, append the markdown to `$GITHUB_STEP_SUMMARY`, print one log line per run and then the annotation as the last line, and exit non-zero only when the run set is invalid.
- **Test scenarios:** none for the shell, which spawns processes; its decisions are U3's. Execution-time check: the first head run's summary is read before the PR leaves draft, and a job over 20 minutes is reported to the supervisor with its breakdown.
- **Verification:** U5's head run.

---

## Verification Contract

- `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm check:ci` (START-1 to START-4), on the PR head in CI.
- A changeset covers `@systemfsoftware/stryker-js-cli-contract` and `@systemfsoftware/stryker-js` (START-5); its level follows the contract-version law's verdict on the regenerated document.
- The new tests are seen running in the head's CI log: the U1 wire-line and version-law scenarios, the U2 properties and integration scenarios, the U3 properties and integration scenarios, the U4 properties.
- The `bench` job on the head is green, its summary is populated for every project, side A's check and reporting read "not measured" (main predates both), its last log line is the verdict annotation, and the `bench-report` artifact is present.
- Test strength is evidenced only by CI's mutation report on main after merge; the PR body names the source regions the new tests target so that report's mutant ids can be cited. No local mutation, planted bugs or hand-applied mutants.
- No local bench or mutation runs; the CLI refuses them outside CI (`packages/stryker-js/src/refuse-local-mutation.workflow.ts:40-42`).
- Test layers, admitted by the test-layer selection gate: schema round-trip and refusal scenarios for the contract member (U1, `schema`); property tests only for the pure decisions (U2 interval union and phase law, U3, U4, all `workflow`); one in-process integration scenario pair for the engine's verdict line (U2, existing `check-cost-record.integration.test.ts`). Refused: tests for the orchestrator shell and the workflow file (process spawning; proven by the head run instead), and any test that only re-asserts the moved catalog code's import path.

## Definition of Done

- U1-U6 land in one PR whose head CI is green, with the `bench` job present and populated (R12).
- The measured job wall-clock and its breakdown are stated in the PR body; a job over 20 minutes was reported to the supervisor before anything shrank.
- Each of R1-R12 (with R8a and R9a) traces to a unit above, and each of AE1-AE3 is a test or an observed head run.
- No leftover scaffolding: no unused corpus entries, no commented-out workflow steps, no copy of `catalog-resolution.ts` left in `test/e2e`.
