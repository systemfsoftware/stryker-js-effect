---
title: Bench On Main Only - Plan
type: ci
date: 2026-10-11
topic: bench-main-only
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-11-0909-ci-bench-main-only-plan.md
---

# Bench On Main Only - Plan

## Goal Capsule

- **Objective:** Each commit that lands on main gets a bench report. Per phase, it shows what the commit made faster or slower than its first parent, the job's wall time against its target, and, for a regression, the culprit SHA and what root does next. No pull request waits on the bench, and a bench timing never turns a job red.
- **Means:** `.github/workflows/bench.yml` moves from `pull_request` to push on main plus `workflow_dispatch`. One uniform 60-minute job timeout replaces every bench deadline. The lockfile-pinned enterprise install is carried over from `stryker/bench-lane-fit`.
- **Product authority:** Ryan (root), ruling of 2026-10-11, relayed by the sub-conductor. This plan replaces the bench-lane-fit unit. That branch and its worktree stay untouched. For the bench lane only, it reverses R1, R11, R12, KTD1 and the merge-base half of KTD2 in `docs/plans/2026-10-10-1719-perf-execution-engine-bench-lane-plan.md`. The rest of that plan stands.
- **Edit scope:** `.github/workflows/bench.yml` is the only workflow this unit may edit (approved for this file only). `ci.yml`, `mutation.yml` and every other workflow belong to Stream K.
- **Stop conditions:** no local bench, mutation or e2e runs. No new dependency or executable. Stop and ask before any probe or planted bug in `src`.
- **Open blockers:** none.

---

## Product Contract

### Summary

The bench lane leaves the pull-request path and runs once per main commit, comparing it against its first parent with the same interleaved A/B protocol. Time is measured and reported, never enforced: GitHub's 60-minute job timeout is the only kill. A leg fails only when the bench itself cannot produce a comparison. A regression names the culprit and root's next action, and the lane stays report-only.

### Problem Frame

Today the lane runs on every pull request (`bench.yml:3-7`) and fails PRs on its own time budget. Three in-process caps turn a slow leg red:

- **Setup budget.** The setup budget derived from `BENCH_DEADLINE_MS` aborts with `setup-timed-out` (`test/bench/src/main.ts:118`, `:183-197`).
- **Run deadline.** The same deadline stops runs with `budget-exceeded` (`test/bench/src/run-bench.service.ts:212-248`).
- **Per-run timeout.** A 10-minute per-run CLI timeout turns a run into an invalid `timed-out` sample (`main.ts:42`, `:122`; `run-bench.service.ts:112-115`).

The workflow sets `timeout-minutes: 1` on `plan` and `9` on `bench`, and `BENCH_DEADLINE_MS` is the job start plus 450 000 ms (`bench.yml:20`, `:39`, `:47-48`). Root's ruling is that CI time budgets are measured, not enforced. Scripted end-to-end runs therefore leave the PR path.

The enterprise leg also stalls on main as it stands. `prepare-side.service.ts:493-504` installs with `npm install --before=<side's last pnpm-lock commit time>`. Main's `pnpm-lock.yaml` last changed at 2026-10-11T08:53Z (6c6eaaa99), after `@effect/opentelemetry@4.0.3` was published at 2026-10-10T10:03:40Z. That release has a peer on `effect ^4.0.3`, which npm does not have: `latest` is 4.0.2 and `effect@4.0.3` returns 404. `--before` therefore admits the broken release, and npm's resolver loops on the peer. Once the deadlines are gone, that leg would run into the 60-minute backstop with no verdict on its first main run.

### Key Decisions

- **The bench runs postsubmit on main.** (session-settled: user-directed — chosen over keeping the PR trigger with bench-lane-fit's Finding 1 fix: scripted end-to-end runs leave the PR path.) Governs R1, R2, R3.
- **One uniform 60-minute job timeout is the only kill.** (session-settled: user-directed — chosen over per-step setup limits and over a raised cap: a deadline that turns a leg red enforces a time budget, and a raised cap is the same thing with a bigger number.) Governs R5, R6, R9.
- **The lane reports a regression and never acts on it.** (session-settled: user-directed — chosen over automatic revert or issue creation: root decides between a revert PR and a root-fix P0.) Governs R4, R10, R11.
- **A setup failure on either side is `side-setup-failed` and red.** (session-settled: user-directed — chosen over carrying bench-lane-fit's both-sides setup classification, retry and per-step limits: on main, a setup failure means the comparison cannot be computed.) bench-lane-fit's review findings 2 and 3 fixed only that classification, so neither applies here. Governs R7.
- **Only the lockfile-pinned enterprise install carries over from bench-lane-fit.** (session-settled: user-directed — chosen over carrying the Turbo restore from base (9797b7a3b) and the corpus narrowing (69856d908): those served the per-job deadline that this unit deletes.) Governs R12.
- **The leg target is 10 minutes.** No systemfsoftware compound pack names a per-job budget. Upstream main at 02bf9653 ships exactly boundary-testing, cell-architecture, mutation-discipline, package-topology, schema-laws and storybook-testing, so the ruling's fallback applies. The nearest repo figure is the same: the 10-minute PR-job ceiling, R3 of `docs/plans/2026-10-10-0702-perf-ci-wall-clock-plan.md`. (session-settled: user-directed — the fallback was named in the ruling.) Governs R9.
- **The report schema moves to `2.0` and the PR title carries `!`.** Deleting decodable codes breaks readers of earlier reports. #274 (70aaafd26, `feat(repo)!:`) and #262 (4bf59526d, `feat(stryker-js)!:`) marked their breaks with `!`. #274's 1.0 to 1.1 step was additive, so removing codes takes the major step. Governs R6, R10.
- **Only a leg's `total` decides a regression; every other phase attributes it.** (session-settled: user-directed, round-2 review R1 — chosen over requiring two regressed metrics, because the phases are correlated with `total` and `mutation-test` is most of it, so two-metric agreement is close to one metric; and over a "re-run" next action, because the bench has no cross-run memory and every false alarm would cost a root turn.) A decisive verdict also needs |Δ median| >= max(3% of A's median, 10 ms): readings are integer ms, and a phase whose A median is 0 (`instrument` is 0-1 ms on every leg) makes the 3% bar zero, so a 1 ms separation would read as regressed. The derivation: complete separation in one direction in a 4-vs-4 ABBA schedule has null probability 1/C(8,4) = 1/70 per cell. Over the ~28 cells of the four legs, a rule that fires on any cell raises a false regression on up to 1 - (69/70)^28 ~ 33% of unchanged commits. Over the four totals it is at most 4/70 ~ 5.7%, and the 3% bar cuts it further because a total's run-to-run range is ~0.5-2% (bench run 38071277981, the #274 head run). That run also shows the rule still catches real regressions: typescript-checker total +4.1% and e2e-core total +6.0% were both separated. Governs R10.

### Requirements

**Trigger**

- R1. `bench.yml` has no `pull_request` trigger. It runs on push to main, keeping today's `paths-ignore` for `**/*.md` and `docs/**`, and on `workflow_dispatch`.
- R2. Side B is `github.sha` and side A is its first parent (`github.sha^1`). The same-runner A/B protocol of the 1719 plan (R2, R5-R8a) is otherwise unchanged.
- R3. Runs share the concurrency group `bench-${{ github.sha }}` with `cancel-in-progress: false`, so no main commit's bench is ever cancelled by a later push.
- R4. Permissions stay `contents: read`. The lane opens no issue, reverts nothing, and writes nothing outside its own step summary, annotations and artifacts.

**Failure and time**

- R5. Every `timeout-minutes` in `bench.yml` is 60. That job timeout is the lane's only kill.
- R6. The bench has no in-process deadline. `BENCH_DEADLINE_MS`, the setup budget, the run deadline and the per-run CLI timeout are removed, together with the report shapes only they produced: abort codes `setup-timed-out` and `budget-exceeded`, run exit `timed-out`, and run failure code `timeout`.
- R7. A leg exits non-zero only when the bench itself fails: a run errors or its stream cannot be read (`failed`), or the comparison cannot be computed (`aborted`). A setup failure on either side aborts with `side-setup-failed`.
- R8. The leg's first step records the job start as a mark, never a deadline. The leg's wall time, from that mark to report write, appears in both the step summary and the JSON report, rendered from the one report object (#274's single-source invariant, guarded by `test/e2e-core/src/__tests__/render-bench-report.workflow.property.test.ts`).
- R9. The leg target is 10 minutes. It is declared once in the repository with its source beside it and shown next to the wall time. An overrun is reported text only. It never changes the exit code or the verdict line's level.

**Regression report**

- R10. When a leg's `total` regressed, the verdict line, the step summary and the JSON report all carry the same fields: reason code `phase-regressed`, this SHA, the parent SHA, and the regressed metrics with their delta in ms and in percent of side A's median: that `total` first, then every phase of the same leg that also regressed, as attribution. They also carry the next action verbatim: "root opens a revert PR of the culprit or a root-fix P0". A phase that regressed while its leg's `total` did not stays in the table as a diagnostic verdict only, with no regression block and no `::error` line. A verdict is decisive only when the four-run samples do not overlap and |Δ median| >= max(3% of A's median, 10 ms).
- R11. A computed regression is still a `summarized` outcome. The leg exits 0 and the verdict line stays `::error`, as `test/e2e-core/src/render-bench-report.workflow.ts:115-125` renders it today.

**Enterprise install**

- R12. The enterprise fixture installs each registry package at exactly the version the side's own `pnpm-lock.yaml` locks, replacing `--before`. This lands as its own commit.

**Docs**

- R13. `test/bench/README.md` and the `@systemfsoftware/stryker-bench` package description cover four things: the main-only trigger, the first-parent side A, the 60-minute backstop and the report-only wall time. No deadline text remains.

### Acceptance Examples

- AE1. **Covers R1, R3.** **Given** this unit's PR, **when** its checks are listed, **then** no Bench check appears on it, and a search of `.github/workflows` on its head finds no `pull_request` trigger in `bench.yml`.
- AE2. **Covers R2, R10, R11.** **Given** a main commit whose `mutation-test` phase on one project is slower than its parent's past the signal rule, and so is that project's `total`, **when** the leg reports, **then** the job exits 0. The verdict line is `::error` with `phase-regressed`, both SHAs, that project's `total` and then its `mutation-test`, each with the delta in seconds and percent, and the verbatim next action. The JSON report holds the same fields. **Given** only `check` separated past the rule while `total` did not, **then** the table reads `regressed` on `check`, the verdict line is a `::notice`, and the report's `regression` is null.
- AE3. **Covers R8, R9.** **Given** a leg whose wall time is 14 minutes, **when** it reports, **then** the summary shows 14 minutes against the 10-minute target. Its exit code and verdict level are what a 6-minute leg with the same cells would get.
- AE4. **Covers R5, R6.** **Given** a run or setup command that never returns, **when** it hangs, **then** no bench code stops it and GitHub cancels the job at 60 minutes.
- AE5. **Covers R7.** **Given** side A's closure build exits non-zero and side B is ready, **when** setup ends, **then** the report aborts with `side-setup-failed` naming side A and the step, and the job exits 1.
- AE6. **Covers R12.** **Given** the registry holds a release newer than the side's locked version, with a peer on an unpublished version (as `@effect/opentelemetry@4.0.3` does today), **when** the fixture installs, **then** the locked version (4.0.0) is installed and the install completes.

### Scope Boundaries

- Nothing else from bench-lane-fit: setup classification, setup retry, per-step limits, the Turbo restore from base, the corpus narrowing.
- No workflow other than `bench.yml` (Goal Capsule, Edit scope), and no change to the e2e fixture bake.
- No automatic revert, issue creation, PR comment or nightly cron. No raised cap in place of a deleted one. No PR-side copy of the bench.
- The Stream G optimisations (per-test coverage, infection filtering, kill ordering, warm workers, verdict parity) are later units that read this lane's main results. They are not part of this unit.

### Dependencies / Assumptions

- **Squash merges.** Main squash-merges PRs: each of the last 20 first-parent subjects ends in `(#N)`. A PR's whole change is therefore one main commit and is benched against the main state it landed on. A direct push of several commits, such as the subtree updates among the 5 merge commits in main's last 50, benches only its head against that head's first parent.
- **No required checks.** Main has no required status checks (ruleset 23172737, recorded in `docs/plans/2026-10-10-0702-perf-ci-wall-clock-plan.md:150`). Dropping the PR trigger leaves no required check pending.
- **The carried commit includes its wiring.** d81f06ad3 and cb151826d add only `test/e2e-core/src/lockfile-pins.*` and a `mod.ts` export, so on their own they are an unwired module. The wiring that replaces `--before` in `test/bench/src/prepare-side.service.ts` (`sideLockfilePins`, `pinManifests`) landed in a48e56ce3. The `ManifestField` literal that main-side code needs landed in e14ab5f2a. Both commits also carry dropped work. The carried commit is therefore d81f06ad3 plus cb151826d plus those two hunks, applied by hand, and it touches only the fixture install and the lockfile-pins files.
- **Runner pool.** The pool already queued Mutation shards at about 55 concurrent jobs (0702 plan, line 271). The bench adds one job per corpus entry (4 today) to every main push, running alongside CI and Mutation. A leg's own A/B is unaffected because both sides run on one runner. Mutation's queue time (0702 R5) may grow.
- **Packages are private.** `@systemfsoftware/stryker-bench` and `@systemfsoftware/stryker-e2e-core` are both `"private": true`, so no changeset applies.

### Outstanding Questions

**Deferred to Planning**

- Where the 10-minute target is declared: `bench.yml` env or a report-schema constant. R9 requires exactly one place.
- Whether the job-start mark reuses `ci.yml`'s `JOB_STARTED_AT` (Unix seconds, `ci.yml:69`) or records milliseconds.
- How a `workflow_dispatch` on a non-main ref labels its report, since side A is still the dispatched head's first parent.
- Turbo restore order on main. Side A's entry is main's previous commit, which `ci.yml`'s `check` saves and the sweep keeps (3 newest main entries, `ci.yml:267`). Side B's entry may not exist yet because CI runs concurrently. Also whether the bench saves entries at all, given the sweep.

### Sources

- `.github/workflows/bench.yml` (trigger, timeouts, deadline step, merge-base side A).
- `test/bench/src/main.ts`, `test/bench/src/run-bench.service.ts`, `test/bench/src/prepare-side.service.ts`.
- `test/e2e-core/src/bench-report.schema.ts` (abort codes, `schemaVersion: '1.1'`), `test/e2e-core/src/bench-run.schema.ts` (`RunExit`, `BenchRunFailureCode`), `test/e2e-core/src/render-bench-report.workflow.ts`.
- `docs/plans/2026-10-10-1719-perf-execution-engine-bench-lane-plan.md`: the lane's design; this plan reverses only the decisions listed in the Goal Capsule.
- `docs/plans/2026-10-10-0702-perf-ci-wall-clock-plan.md`: R3 10-minute PR-job ceiling, the runner-pool and required-check facts.
- `.github/actions/job-report/action.yml` and `ci.yml:68-69`: the existing job-start mark and reason-code reporting convention.
