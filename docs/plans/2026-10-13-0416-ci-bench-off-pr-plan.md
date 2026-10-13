---
title: Bench Off The PR Path - Plan
type: ci
date: 2026-10-12
topic: bench-off-pr
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-13-0258-ci-bench-off-pr-plan.md
---

# Bench Off The PR Path - Plan

## Goal Capsule

- **Objective:** No pull request runs the bench. Each main commit is benched, every leg, against its first parent and gets a report-only result: per-phase deltas, the leg's wall time against a 10-minute target, and, when the leg's `total` regressed, a verdict naming both SHAs, the metrics, a reason code and root's next action.
- **Means:** `.github/workflows/bench.yml` moves from `pull_request` to push on main plus `workflow_dispatch`, with no path filter: every push to main benches every leg. Every in-process deadline is deleted; GitHub's 60-minute job timeout is the only kill. Every measured run executes from one fixed path so the two sides test the same mutant ids.
- **Product authority:** Ryan (root), intent of 2026-10-12: remove the bench from the PR path today. Amended 2026-10-12: never roll your own caching or change classification where Turbo can do the job; bespoke caching survives only with a written rule-4 reason. This plan is layer 1 of a split. Layer 2 (the enterprise install, judged separately) is out of this plan. Branch `stryker/bench-main-only` (#312) stays intact and is the source most hunks are ported from.
- **Edit scope:** `.github/workflows/bench.yml` is the only workflow touched. New bench code lives in `test/bench/**`. In `test/e2e-core`, only pre-existing bench modules are edited, and only where a pre-existing declaration in the same file consumes the change: `bench-report.schema.ts`, `bench-run.schema.ts`, `bench-summary.schema.ts`, `read-bench-run.workflow.ts`, `render-bench-report.workflow.ts`, `summarize-bench.workflow.ts` and their laws. The layer also deletes `test/e2e-core/tests/bench-decisions.integration.test.ts` (see Test Admission). Nothing changes in the e2e fixture bake, any fixture lock, `ci.yml`, `mutation.yml`, `kill-matrix.yml`, product packages, or Stream B's reuse suites.
- **Testing law (root, 2026-10-12):** every new or changed integration test drives the real product through its public surface on a real project and asserts only observable outcomes; a pure decision gets property laws beside it, not an integration test.
- **Scope law (root, 2026-10-13):** no new code goes into `test/e2e-core`; no commit or PR scope is named `e2e-core`; no new `core`, `common` or `shared` test-tooling package. Stream D owns dissolving `test/e2e-core`. This layer's new files live in `test/bench` and nothing else moves:
  - `measure-leg.workflow.ts`, `leg-clock.schema.ts`, `run-path.schema.ts`, `plan-run-path.workflow.ts` and `settle-run-path.workflow.ts`, with their laws, live in `test/bench/src`. They import `BenchSide` and `LegTime` from `@systemfsoftware/stryker-e2e-core`.
  - `measureLeg` decides a bench-local `LegClock` (`LegElapsed` or `LegClockBehind`), and `main.ts` maps it onto the report's `LegTime`. The reason: `make-body-purity` forbids a decision from constructing a class imported from another package, and e2e-core cannot import `test/bench` without a cycle.
  - Ten pre-existing e2e-core files stay edited, for Stream D to move, split four ways:
    - `bench-report.schema.ts`, `bench-summary.schema.ts` and `render-bench-report.workflow.ts` carry additions that a pre-existing declaration in the same file consumes: `BenchReport.leg`, `RenderedFields`, `NEXT_ACTION`, `BenchSummary.regression`, and `renderBenchReport`. `LegTime` is a data union (`S.TaggedUnion`, KD13), so the file declares no new class and no new type id.
    - `bench-run.schema.ts` and `read-bench-run.workflow.ts` delete the `timeout` failure code and `RunExit`.
    - `summarize-bench.workflow.ts` adds the 10 ms floor, which rescaled the pre-existing `∀abk` law onto a 10 ms grid.
    - Four law files: those of `read-bench-run`, `render-bench-report` and `summarize-bench` follow their modules. `read-bench-run`'s laws and `covering-test-files`' laws (whose module is unchanged) also hold the laws re-homed from the deleted `bench-decisions.integration.test.ts`. A law stays beside the module it tests, and root's 2026-10-12 amendment requires those behaviours not be lost. Moving them to `test/bench` would test another package's internals.
    - In-source refusal blocks (KD13). `bench-report.schema.ts`, `bench-summary.schema.ts`, `bench-run.schema.ts` and `summarize-bench.workflow.ts` each gain one `if (import.meta.vitest !== void 0)` block. It states the refusal boundary of the refinements this PR adds or changes in that file, and nothing else. It adds no file, dependency, config or helper module. The mechanism already exists in e2e-core: `annotation.schema.ts:107` and `includeSource` at `vitest.config.ts:12`.

    `mod.ts` is unchanged from main.
  - Commit `0db0ffa8` on this branch is titled `test(e2e-core)`. Rewriting it needs a force push, which the execution profile never uses. Main squash-merges under the PR title `ci(bench)!`, so that subject never reaches main.
- **CONST-W3 declaration:** `AGENTS.md:7` lists `.github/workflows/` as Read-only, and this layer edits `.github/workflows/bench.yml`. The edits are:
  - the trigger: push to `main` plus `workflow_dispatch`, with `pull_request` removed, and both checkouts at `github.sha` (`bench.yml:25,51`);
  - concurrency and job caps: `bench-${{ github.sha }}`, no cancel, 60 minutes;
  - the sides: detached worktrees `$RUNNER_TEMP/bench-a` at `HEAD^1` and `$RUNNER_TEMP/bench-b` at `HEAD`, each with its own released tarballs and `pnpm install` (`bench.yml:66-69`);
  - the checkout: it holds only the harness install (`bench.yml:114`) and the Turbo cache, keyed on `github.sha` (`bench.yml:126`) and passed as `BENCH_TURBO_CACHE_DIR` (`bench.yml:136`);
  - the report steps: `JOB_STARTED_AT`, `BENCH_REF`, and report and run-stream uploads on `always()`;
  - the header and concurrency (KD12): a cost header with the measured runner-minutes, and a concurrency group keyed on `github.sha` for a push and on `github.run_id` for a dispatch.

  The grant is Ryan's (root) intent of 2026-10-12 to take the bench off the PR path. CONST-E9 does not apply: Bench grades main's commits, not this change. The waiver covers only `bench.yml`; no other workflow file is touched.
- **Stop conditions:** no local bench, mutation or full e2e runs; no new dependency or executable.
- **Open blockers:** none.

---

## Product Contract

### Summary

The bench leaves the pull-request path and runs once per main commit, every leg, comparing it with its first parent through the existing interleaved A/B protocol. Time is measured and reported, never enforced. A leg fails only when the bench cannot produce a comparison. A regression is reported with its culprit and next action, as the leg's `::error` annotation and step summary on that commit's Bench run; the lane never acts on it.

### Problem Frame

Today every PR pays for the bench and the bench turns PRs red on its own clock:

- `bench.yml:3-7` triggers on `pull_request`; `bench.yml:12-14` cancels in progress per ref; `bench.yml:20,39` cap the jobs at 1 and 9 minutes; `bench.yml:47-48` sets `BENCH_DEADLINE_MS` to job start + 450 000 ms.
- `test/bench/src/main.ts:118,183-197` aborts setup with `setup-timed-out`; `test/bench/src/run-bench.service.ts:212-251` aborts runs with `budget-exceeded`; `main.ts:42,122` and `run-bench.service.ts:113-115` turn a slow run into a `timed-out` invalid sample.
- Five of the last ten PR Bench runs failed (`gh api .../workflows/bench.yml/runs`, 2026-10-12 17:31-17:53Z). In 38284821646, three legs report `Bench invalid ... stream-undecodable, exit 0`, and the typescript-checker leg aborted with `budget-exceeded` ("the job deadline stopped run 8 of 8 (side B) after 8530 ms"). Only that abort is a deadline failure. The run is on `stryker/agent-surfaces-u3` (#298), which changes the stream contract (`packages/stryker-js-cli-contract/src/run-event.schema.ts`, `stream-version.schema.ts`). The harness decodes both sides' streams with the checkout's `RunEvent` (`test/e2e-core/src/read-bench-run.workflow.ts:2`), so the side that runs the other contract is undecodable. Removing the deadlines does not fix this; see Risks. The cause of 38280183277 was not traced.

Side A today is a worktree at `RUNNER_TEMP/bench-a` and side B is the job checkout (`bench.yml:60-74,116-124`). Mutant ids and `runInputsDigest` hash absolute paths, so the sides test the same mutants under different ids in a different order. A/A run 38135504932 on that layout recorded different project roots, inputs digests and mutant-id digests per side and emitted a false `phase-regressed` on the typescript-checker leg (`total` +1311.5 ms, 3.5%). Three A/A runs that executed every run from one fixed path (38140987766, 38143012318, 38279943505) recorded identical inputs and id digests across sides and no regression. A postsubmit lane that names culprits from the old layout would send root false revert verdicts, so the fixed run path is part of this layer.

Main's regression rule today flags any phase whose samples separate by 3% of A's median (`test/e2e-core/src/summarize-bench.workflow.ts:196-197`), and `render-bench-report.workflow.ts:116-120` turns any regressed phase into `::error Bench regression`. `instrument` medians are 0-1 ms, so a 1 ms separation is a regression. The regression carries no parent SHA, metric list or next action.

### Key Decisions

- KD1. **Postsubmit on main plus manual dispatch.** (session-settled: user-directed, root intent 2026-10-12, chosen over keeping a PR trigger with a fixed deadline: scripted end-to-end runs leave the PR path.) Governs R1-R3.
- KD2. **One 60-minute job timeout is the only kill.** (session-settled: user-directed, chosen over a raised in-process cap, which is the same enforcement with a bigger number.) Governs R5, R6.
- KD3. **Report-only verdicts.** (session-settled: user-directed, chosen over automatic revert or issue creation: root picks between a revert PR and a root-fix P0.) Governs R9, R10.
- KD4. **Split: this layer carries trigger, caps, report-only verdict and the fixed run path; the install change is layer 2.** The root recommended the split; this plan keeps it and adds the fixed run path to layer 1, because without it the layer's culprit-naming verdicts are wrong on product-identical commits (Problem Frame). Run identity gating, provisional reports, lockfile pins, withheld pins and any enterprise-install change stay out: none is needed for trigger, caps, wall time or a correct verdict, and the provisional report in #312 depends on `WithheldPins` (`origin/stryker/bench-main-only:test/e2e-core/src/provisional-report.workflow.ts:24,34`).
- KD5. **Only a leg's `total` decides a regression; every phase that also regressed attributes it.** A decisive verdict needs non-overlapping four-run samples and |Δ median| >= max(3% of A's median, 10 ms). (session-settled: user-directed, #312 round-2 review R1 ruling, chosen over one-phase-is-enough: phases correlate with `total`, and a 0-1 ms phase makes the 3% bar a 1 ms bar.)
- KD6. **The report schema moves to `2.0` and the PR title carries `!`.** Removing decodable abort codes and the `timed-out` run exit breaks readers of `1.1` reports; #274 and #262 marked their breaks with `!`.
- KD7. **Leg target is 10 minutes, declared once as a report-schema literal.** Source: R3 of `docs/plans/2026-10-10-0702-perf-ci-wall-clock-plan.md` (10-minute PR-job ceiling); no compound pack names a per-job budget. The job-start mark reuses `ci.yml:68-69`'s `JOB_STARTED_AT` (Unix seconds).
- KD8. **Two layers, not three.** A trigger-and-caps-only first layer was considered: it would stop PRs paying with less code, but main would then publish verdicts from the two-root layout, which A/A run 38135504932 shows produces a false `::error` regression on a product-identical commit, and those verdicts name no parent, metric or next action. Root would read false culprits. The run path and the regression block land with the trigger.
- KD9. **Must-not-lose status of this layer.** "Every PR stops paying for the bench" holds on merge (R1). "No bench path hangs on a bad upstream publish" does not hold on this layer alone: the enterprise leg still resolves from the registry (Risks). Layer 2 is stacked on this layer and owns that property; whether layer 1 merges before layer 2 is root's call.

- KD10. **Turbo owns task graph and cache; it does not choose which main SHA is benched.** (session-settled: user-directed, root amendment 2026-10-12, chosen over keeping GitHub `paths-ignore`, a hand-written change classifier; and sub-conductor ruling 2026-10-12, chosen over Turbo affected-only leg selection: the acceptance is a comparison per main SHA, and a commit Turbo reports as unaffected can still be the one whose verdict is required.) `paths-ignore` is removed and nothing replaces it. Builds, closures and cache content stay Turbo's (Turbo Compliance).
- KD11. **Affected-only leg selection is deferred, not planned.** It would change the acceptance (a main SHA with no report), which only root can do. It is recorded under Outstanding Questions with its evidence.
- KD12. **Every confirmed pack violation in the full-path receipt is fixed in this PR, each in its own pushed commit.** (session-settled: user-directed, root intent 2026-10-13, chosen over merging with the violations escalated or waived.) The rows: #8 `four-channel-contracts`, #9 `data-only-schema-classes`, #10 `invariants-as-refinements` (`wallMs` and `ref`), #11 `tagged-unions-over-state-by-presence`, #12 `refusals-beside-generated-laws`, #14 `heavy-lanes-state-their-daily-minutes`, #15 `heavy-suites-judge-every-main-commit`. #13 `surface-changes-are-versioned` stays rejected (the package is private). Governs U7-U12.
- KD13. **The e2e-core boundary for those fixes.** New code goes to `test/bench`. Two fixes must land in pre-existing e2e-core files: #9 (`LegTime` is declared there and consumed by `BenchReport` and `renderBenchReport`) and #12 (`refusals-beside-generated-laws` places a refusal in the refined schema's own file and bans a separate refusal file). Each takes its narrowest form. For #9, `LegTime` becomes an `S.TaggedUnion`, which removes two classes and a type id. For #12, one in-source block per file covers only the refinements this PR added or changed. No new e2e-core file, export, dependency, config or helper is added. Stream D moves these files with their blocks.
- KD14. **Bench's push run stays a full-corpus comparison with the first parent; the header prices that run.** (session-settled: user-directed, KD1, KD10 and KD11, plus root intent 2026-10-13 asking for the per-push and per-day figure.) The corpus is a fixed workload, and only the engine differs between sides. A diff from the lane's last green commit would select no smaller workload, and it would credit several pushes' speed change to one commit. `heavy-suites-judge-every-main-commit`'s Scope bullet is therefore answered in the header, not by changing the run. If the re-review still rules it a violation, it goes to root.
- KD15. **Causes are carried as `S.Unknown`, per the repo rule.** `four-channel-contracts.md:14` prescribes `cause: Schema.optional(Schema.Unknown)`, and `BenchSetupFailed` (`prepare-side.schema.ts:6`) already uses that shape. That is chosen over the external Effect 4 convention, `Schema.Defect`: the value carried is an Effect `Cause`, which a `Defect` codec reduces to a name and a message.

### Requirements

**Trigger**

- R1. `bench.yml` has no `pull_request` trigger and no path filter. It runs on push to `main` and on `workflow_dispatch`.
- R2. Side B is `github.sha`; side A is its first parent. Both are detached worktrees under `RUNNER_TEMP` (`bench-a`, `bench-b`). Each side gets its own `.sfs-deps` (side B copies the checkout's released tarballs; side A copies them when its `stryker-published` pin matches, else builds its own from its pin, as today) and its own `pnpm install --frozen-lockfile`, each timed into `bench-setup.tsv`. The job checkout holds only the harness and its timed install.
- R3. Concurrency group `bench-${{ github.sha }}` with `cancel-in-progress: false`: a later push never cancels an earlier commit's bench.
- R4. Permissions stay `contents: read`. The lane writes only its step summary, annotations and artifacts.

**Time and failure**

- R5. Every `timeout-minutes` in `bench.yml` is 60.
- R6. The bench has no in-process deadline: `BENCH_DEADLINE_MS`, `BENCH_RUN_TIMEOUT_MS`, the setup budget, the run deadline and the per-run timeout are removed, with the shapes only they produce: abort codes `setup-timed-out` and `budget-exceeded`, run exit `timed-out`, run failure code `timeout`.
- R7. A leg exits non-zero only when the bench itself fails: a run errors or its stream is unreadable (`failed`) or the comparison cannot be computed (`aborted`). A computed regression is `summarized` and exits 0.
- R8. The leg's wall time (from `JOB_STARTED_AT` to report write) and the 10-minute target appear in the JSON report and the step summary, rendered from one report object. An overrun changes neither exit code nor verdict level.

**Fixed run path**

- R11. Every measured run, both sides and every leg, executes from `RUNNER_TEMP/bench-run`: the side's tree is renamed there before the run and back after, also when the run fails. The run path existing before a move-in aborts with `run-path-occupied`; a failed listing or move-in rename aborts with `run-path-move-failed` carrying the OS error; a failed move back aborts with `run-path-unrestored` carrying the rename error and the run's own failure if any. Each abort carries a next action.
- R12. The bench config written into a side's tree references its plugins relative to the config file, so it resolves after the tree moves. The Turbo cache directory the bench passes to builds is the checkout's `.turbo/cache`, the path `bench.yml`'s cache step restores, not a path inside a side tree.

**Regression report**

- R9. When a leg's `total` regressed (KD5), the verdict line, step summary and JSON carry one regression block: reason code `phase-regressed`, SHA, parent SHA, ref, the regressed metrics (`total` first, then every regressed phase of that leg) with Δ in ms and percent of A's median, and the next action. On `refs/heads/main` the next action is verbatim "root opens a revert PR of the culprit or a root-fix P0"; on any other ref it is "dispatched on <ref>: speed evidence only, no revert". A phase that regressed while `total` did not stays a table verdict only: no regression block, `::notice` level.
- R10. The verdict line is `::error` for a regression and for `failed`/`aborted`, `::notice` otherwise; only `failed`/`aborted` set exit 1.

**Docs**

- R13. `test/bench/README.md` and the `@systemfsoftware/stryker-bench` package description state the main-only trigger, first-parent side A, fixed run path, 60-minute backstop and report-only wall time; no deadline text remains.

### Acceptance Examples

- AE1. Covers R1, R3. Given this PR, when its checks are listed, then no Bench check appears, and `bench.yml` on its head has no `pull_request` key.
- AE2. Covers R9, R10. Given a project whose `total` and `mutation-test` both separate past the rule, the report is `summarized`, exit 0, verdict `::error` with `phase-regressed`, both SHAs, `total` then `mutation-test` with Δ s and %, and the main next action. Given only `check` separates, the table reads `regressed` on `check`, `regression` is null, and the line is `::notice` titled `Bench phase-only slowdown`; it says no leg total crossed the regression threshold and names the `check` cell as a phase-only slowdown, never as regressed.
- AE3. Covers KD5. Given A's `instrument` median is 0 ms and B's samples are all 1 ms, the cell is `no-signal`.
- AE4. Covers R8. A leg reported at 14 minutes shows 14 min against the 10-minute target; exit code and verdict level equal those of the same cells at 6 minutes.
- AE5. Covers R5, R6. A run or setup command that never returns is stopped by nothing in bench code; GitHub ends the job at 60 minutes.
- AE6. Covers R11. Given anything at `RUNNER_TEMP/bench-run` before a move-in, the leg aborts `run-path-occupied` naming side and path. Given the move-back fails after a failed run, `run-path-unrestored` carries both errors.
- AE7. Covers R2, R11, R12. A `workflow_dispatch` on this PR's head (a product-identical commit and parent): every leg's runs on both sides record one project root and identical inputs and mutant-id digests in their uploaded incremental reports, and no leg's `total` regresses.

### Scope Boundaries

- Out (layer 2 or later): run identity gate (`run-path-mismatch`, `run-identity-unreadable`), provisional `leg-incomplete` reports, lockfile pins, `withheldPins`, deleting or consuming the fixture's committed `package-lock.json`, any change to the enterprise `npm install --before` step.
- Out: automatic revert, issue, PR comment, nightly cron, a raised in-process cap or deadline (KD2's rejected option), a PR-side bench copy, Turbo restore-from-base, corpus narrowing.
- Out (Stream K): enabling a Turbo remote cache and the repo-wide `actions/cache` transport of `.turbo/cache` (`ci.yml`, `mutation.yml`, `kill-matrix.yml`, `bench.yml`); the `test/bench/oxlint.config.ts` boundary diagnostic; adding `test/bench` to the mutation lane (`mutation.yml:36` `PROJECTS` plus a `test/bench/stryker.config.ts`). Until then, the moved workflows have property laws but no mutation grading. The e2e-core code that stays (`LegTime` and the abort codes) keeps its covering laws through `render-bench-report`'s `LegTime` arbitrary.
- Out: Stream G execution-engine optimisations.

### Dependencies / Assumptions

- **No required status checks on main.** The `main` branch rules are `deletion`, `non_fast_forward`, `pull_request` (`gh api repos/.../rules/branches/main`, 2026-10-12); dropping the PR trigger leaves nothing pending. Per `docs/solutions/workflow-issues/matrix-legs-rename-the-required-status-check.md`, recheck at PR time.
- **Squash merges.** One PR is one main commit benched against the state it landed on; a multi-commit direct push benches only its head against that head's first parent.
- **Packages are private.** `@systemfsoftware/stryker-bench` and `@systemfsoftware/stryker-e2e-core` are `"private": true`; no changeset.

---

## Planning

### Context and Research

- Main's bench today: `.github/workflows/bench.yml` (142 lines), `test/bench/src/main.ts`, `run-bench.service.ts`, `prepare-side.service.ts:187-233` (absolute plugin URLs via `path.toFileUrl`), `main.ts:41,176` (Turbo cache dir under side B's root).
- Report and verdict types: `test/e2e-core/src/bench-report.schema.ts:20-29` (abort codes, `schemaVersion: '1.1'` at `main.ts:127`, `run-bench.service.ts:271`), `bench-run.schema.ts` (`RunExit`, `BenchRunFailureCode`), `bench-summary.schema.ts`, `summarize-bench.workflow.ts:196-197`, `render-bench-report.workflow.ts:95-125`, `main.ts:243-261` (exit 1 only for `failed`/`aborted`).
- Port source: `origin/stryker/bench-main-only` (#312). Its files for this layer: `run-path.schema.ts` (minus the run-identity classes), `plan-run-path.workflow.ts`, `settle-run-path.workflow.ts` and `measure-leg.workflow.ts`, all placed in `test/bench/src`; plus, edited in place in `test/e2e-core/src`, the `LegTime`/`LegTargetMs` part of `bench-report.schema.ts`, the regression block of `bench-summary.schema.ts` and `summarize-bench.workflow.ts`, `render-bench-report.workflow.ts`, `read-bench-run.workflow.ts` and `bench-run.schema.ts`; and `test/bench/src/{main,run-bench.service,prepare-side.service,prepared-side}.ts`.
- Learnings applied: `docs/solutions/workflow-issues/mutation-lane-green-while-every-job-failed.md` (the result gate keys on the run's own verdict line; removing aborts must not weaken `readBenchRun`); `docs/solutions/tooling-decisions/do-not-sleep-to-prove-a-mutation-timeout.md` (laws assert the reported wall time, never elapsed time); `docs/solutions/performance-issues/checker-equivalence-emit-left-js-beside-project-sources.md` (repeated runs start from a restored tree; leftovers are inputs); `docs/solutions/workflow-issues/shared-deno-import-map-feeds-the-e2e-trace-scripts.md` (find every consumer of a removed name before deleting it).
- Packs: schema-laws (property laws over production schemas), boundary-testing (no mocks; real inputs through real workflows), cell-architecture (decisions in `*.workflow.ts`, I/O in `*.service.ts`/bench drivers).

### Key Technical Decisions

- KTD1. Port by hand from `origin/stryker/bench-main-only` onto a branch cut from `origin/main`, not a cherry-pick: #312's commits interleave this layer's hunks with identity, provisional and pins work.
- KTD2. Run-path planning and settling are pure workflows (`planRunPath`, `settleRunPath`) over a directory listing and rename outcomes; the renames live in `run-bench.service.ts`. This keeps the abort decisions under property laws.
- KTD3. Abort-code set after this layer: `environment-incomplete`, `corpus-unreadable`, `setup-timings-malformed`, `entry-unknown`, `side-setup-failed`, `report-unwritable`, `run-path-occupied`, `run-path-move-failed`, `run-path-unrestored`, `defect`. `RunPathOutsideTree` maps to `run-path-move-failed`, not `defect` (spec-flow finding: #312 mislabels it). `defect` is for an escaping Effect defect, and its next action reads the stack, which a typed failure does not have. The `run-path-move-failed` next action names both causes: an OS error, which needs a runner fix, and a path outside the tree, which is a bug in side setup.
- KTD4. Side A is resolved with `git rev-parse --verify HEAD^1` in the checkout (`fetch-depth: 0` kept: the enterprise `--before` cutoff reads `pnpm-lock.yaml` history). A missing parent fails that step with `::error` naming the SHA.
- KTD5. Both upload steps run on `always()`, so a bench abort or a failed step still uploads what exists. A job killed by the 60-minute timeout may leave no report; that gap is layer 2's provisional report or later.

### Turbo Compliance

Run with `skill://turbo-query-optimization` on `stryker/bench-off-pr` at `e684c838`, turbo 2.10.12. Raw outputs: `/tmp/compound-engineering-0/turbo-evidence/` (session scratch).

- **Graph.** `packages`: 25, 24 graph nodes, 104 edges, no circular-dependency warning on stderr. `boundaries`: 20 diagnostics; the only bench one is `test/bench/oxlint.config.ts` importing `../e2e-core/oxlint.config.ts` (pre-existing, not caching; Stream K).
- **Leg closures are Turbo's.** Each repo leg's `turbo run build --dry=json` closure is 17-18 `#build` tasks; the enterprise closure is also derived from `turbo run build --dry=json` inside `prepare-side.service.ts` (`STEP_ENTERPRISE_CLOSURE`).
- **Shared cache dir is sound.** `turbo run build --dry=json --filter=@systemfsoftware/stryker-js` gives identical hashes for all 15 tasks in the checkout and in a worktree at another path, so both side worktrees hit one `--cache-dir` by content only.
- **`paths-ignore` was a hand-written classifier; removing it costs no main-SHA comparison.** Over 11 sampled main commits (`38924e53` back to `3cb13423`), `paths-ignore` (`**/*.md`, `docs/**`) skips none. `turbo query affected --packages ... --exit-code` per leg skips all four legs on `61d40db4` (CI files), `ee2c4cfb` (CI and docs) and `3495e21d` (flake inputs only), runs only `e2e-core` and enterprise on `ddeb67ab` (#311), and only enterprise on `3cb13423`, matching `affectedPackages` reasons (`FileChanged`, `DependencyChanged`, `LockfileChanged`, `ConservativeRootLockfileChanged`). This layer uses that output as evidence only: every push benches every leg (KD10, KD11).
- **If leg selection is ever adopted, the signal is `affected --packages`.** `affectedTasks(tasks: ["build"])` is not a changed set: it includes upstream tasks with reason `TaskAllChanged: required by an affected task`, and its `build` inputs miss the enterprise fixture, which is not a build input (`ddeb67ab`).
- **Limitations.** `turbo query affected` needs full history (a shallow checkout reports every package affected, per Turbo's docs), and it cannot see a change outside any package (for example `bench.yml` itself). Neither matters while every push benches every leg.

Bespoke caching left in this unit, each with its rule-4 reason:

| Mechanism                                                                  | Where                                                                     | Rule-4 reason                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.sfs-deps` released tarballs, cached on the `stryker-published` flake pin | `.github/actions/released-tarballs/action.yml`, `bench.yml` same-pin step | Nix store paths: the tarballs are a Nix flake output; Turbo neither builds nor hashes flake inputs. A pin change that matters also changes `pnpm-lock.yaml` (`LockfileChanged`, `6c6eaaa9`).                                              |
| `actions/cache` transport of `.turbo/cache`                                | `bench.yml` "Turbo cache" step                                            | Content is Turbo's own task cache. The repo has no Turbo remote cache (no `TURBO_TOKEN`/`TURBO_TEAM`/`TURBO_API` in any workflow, no `remoteCache` in `turbo.json`); enabling one needs a credential and is Stream K's repo-wide finding. |

Not caches: `workload-digest.service.ts` (proves both sides ran one workload; skips no work), `pristine-tree.service.ts` (restores the tree between runs). Stryker's incremental reuse is product, and the bench passes `--full` (`run-bench.service.ts`).

### Open Questions

**Resolved during planning**

- Target location: a report-schema literal (`LegTargetMs`), KD7.
- Job-start mark: `JOB_STARTED_AT` seconds, KD7.

**Deferred to implementation**

- Whether `bench.yml`'s Turbo cache key on push uses `github.sha` or the parent; the save/restore names must keep today's `turbo-<os>-bench-<slug>-` prefix. (Resolved in layer 1: `github.sha`.)

**Deferred to root (not planned)**

- Affected-only leg selection (KD11). Turbo's `affected --packages` would skip legs on 3 of 11 sampled main commits. Adopting it means a main SHA can end with no Bench report, which contradicts the acceptance; it is planned only if root changes the acceptance.

### Implementation Units

- U1. **Workflow trigger, sides and caps.** Files: `.github/workflows/bench.yml`. Push-main + dispatch trigger, `bench-${{ github.sha }}` concurrency without cancel, every `timeout-minutes: 60`, `JOB_STARTED_AT` first step, deadline step deleted, side A = first parent and side B = `github.sha` as worktrees, harness installed and timed in the checkout, `BENCH_TURBO_CACHE_DIR` and `BENCH_REF` passed, uploads on `always()`. Covers R1-R5, R8, R12. Verification: AE1 by reading the head's `bench.yml`; AE7 by dispatch.
- U2. **Report schema and deadline removal.** Files: `test/e2e-core/src/bench-report.schema.ts`, `bench-run.schema.ts` and `read-bench-run.workflow.ts`; in `test/bench/src`, `measure-leg.workflow.ts` and `leg-clock.schema.ts` (both new), `main.ts` and `run-bench.service.ts`; plus the matching `__tests__` laws. Remove the R6 shapes; move the schema to `2.0`; put `LegTime` in the report. Covers R6-R8. Tests: the `measure-leg` law (elapsed time versus negative clock skew -> `LegClockBehind`, which the shell maps to `LegNotMeasured`); the `read-bench-run` laws lose their `timed-out` cases.
- U3. **Regression block.** Files: `bench-summary.schema.ts`, `summarize-bench.workflow.ts`, `render-bench-report.workflow.ts` and their laws. Covers R9, R10, KD5. Tests: `total`-decides, phase-only regression is notice, 10 ms floor (AE3), main vs non-main next action, wall time line independent of exit (AE4).
- U4. **Fixed run path.** Files: `test/bench/src/run-path.schema.ts`, `plan-run-path.workflow.ts` and `settle-run-path.workflow.ts` (all new), `run-bench.service.ts`, `prepare-side.service.ts` (relative plugin URLs), `prepared-side.ts`; plus the `bench-report.schema.ts` abort codes in e2e-core. Covers R11 and R12. Tests: `plan-run-path` and `settle-run-path` laws in `test/bench/src/__tests__`. They cover an occupied path, a failed move, and a tree left unrestored, with and without a run failure. They also cover a cwd equal to the tree, as on the enterprise leg.
- U6. **Bench test lane.** Files: in `test/bench`, `package.json` (a `test` script, `lint:tsgo` over `tsconfig.test.json`, devDependencies `@systemfsoftware/effect-cell-types`, `@systemfsoftware/effect-schema-law`, `@systemfsoftware/vitest`, `@systemfsoftware/vitest-config`, `fast-check` and `vitest`), `vitest.config.ts` (same shape as `test/checker-parity`, with `inSourceSchemaLaws()`), `tsconfig.test.json`, and `tsconfig.json`/`tsconfig.app.json` references; plus `pnpm-lock.yaml`. There is no `stryker.config.ts`: the mutation lane's projects are hard-coded in `mutation.yml:36` (Stream K), so an unenrolled config would never run.
- U5. **Docs.** `test/bench/README.md`, `test/bench/package.json` description. Covers R13.
- U7. **Run-path settle carries tagged outcomes with causes (#8, #11).** Files: `test/bench/src/run-path.schema.ts`, `settle-run-path.workflow.ts`, `run-bench.service.ts` and the settle law. The move-back and the run's own end become tagged unions (`MovedBack` or `MoveBackFailed { cause }`, and `RunSucceeded` or `RunFailed { cause }`). `RunPathUnrestored` carries `cause: S.optional(S.Unknown)` and the run's end; it holds no strings. The service passes each `Exit`'s `Cause`. Text is rendered once, in the error's `message`, when the report's reason is built. Test: the settle law. Unrestored holds exactly when the move-back failed, and the error carries both causes by identity and names both failures' text.
- U8. **LegTime as a data union (#9).** Files: `test/e2e-core/src/bench-report.schema.ts`, `test/bench/src/main.ts`, and the `render-bench-report` law. `LegTime = S.TaggedUnion({ LegMeasured, LegNotMeasured })`; consumers use `LegTime.cases.*`. The encoded shape is unchanged.
- U9. **Refine the leg's elapsed time and the report's ref (#10).** Files: `test/bench/src/leg-clock.schema.ts` (`wallMs` finite and `>= 0`), `test/e2e-core/src/bench-report.schema.ts` (`ref: S.NonEmptyString`, matching `SummarizeBenchCommand.ref`), and `test/bench/src/main.ts` (`BENCH_REF` read with `Config.NonEmptyString`, so an empty value takes the `environment-incomplete` path).
- U10. **Refusal properties beside every refinement this PR adds or changes (#12).** In `test/bench`: `run-path.schema.ts`, `leg-clock.schema.ts`, `plan-run-path.workflow.ts`, `settle-run-path.workflow.ts` and `measure-leg.workflow.ts`. In e2e-core, per KD13: `bench-report.schema.ts`, `bench-summary.schema.ts`, `bench-run.schema.ts` and `summarize-bench.workflow.ts`. Each block draws from the unrefined base, adds boundary seeds, and compares the decode verdict with an independent predicate. Each `subject` is a private predicate (`in-source-test-targets-private`; precedent `annotation.schema.ts:104-140`).
- U11. **Dispatch concurrency (#15).** File: `.github/workflows/bench.yml`. The group is `bench-${{ github.event_name == 'push' && github.sha || github.run_id }}` with `cancel-in-progress: false`. A comment states why side A is `HEAD^1` (KD14).
- U12. **Cost header (#14).** File: `.github/workflows/bench.yml`. The header states the run shape every push starts, its per-run job-minutes with run ids, the per-day figure at the measured 7-day first-parent merge count and window, and whether the lane can starve PR CI. Every number comes from the PR body's measured Bench cost section (job timestamps); nothing is rerun.

### Test Admission

Gate: `test-layer-selection` permission matrix, default refuse. `inSourceSchemaLaws()` generates schema codec laws for every exported schema of the package (`test/e2e-core/vitest.config.ts:8`, `test/bench/vitest.config.ts`), so no hand-written schema test is admitted. In `test/bench` that generation also covers pre-existing schemas this PR does not touch (`bench-failure`, `bench-target`, `prepare-side`), because the plugin scans the whole `src` directory.

| Proposed test                                                                                                             | Cell             | Verdict                                            | Plausible bug it catches                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `measure-leg.workflow.property.test.ts` (`test/bench`)                                                                    | workflow         | admit                                              | wall time computed from the wrong unit (seconds vs ms), or a negative elapsed reported as measured                                                                                                                                                                                                                             |
| `summarize-bench` laws: `total` decides, phase-only regression yields no block, 10 ms floor, block lists `total` first    | workflow         | admit                                              | a 1 ms `instrument` separation or a phase-only separation emitting a culprit verdict                                                                                                                                                                                                                                           |
| `render-bench-report` laws: next action by ref, verdict level and exit independent of wall time                           | workflow         | admit                                              | a dispatched branch run telling root to revert; an overrun changing the exit                                                                                                                                                                                                                                                   |
| `plan-run-path` / `settle-run-path` laws (`test/bench`)                                                                   | workflow         | admit                                              | a run starting on an occupied path; a failed restore swallowed when the run also failed                                                                                                                                                                                                                                        |
| `read-bench-run` law changes                                                                                              | workflow         | edit: delete `timed-out` cases                     | n/a (removed shape); the 60-minute backstop is `bench.yml` config and the removed `timeout` code is a compile error, not a law                                                                                                                                                                                                 |
| `run-bench.service.ts` rename sequence, `prepare-side.service.ts` relative URLs                                           | executor/service | refuse; evidence is the A/A dispatch (AE7)         | spawning the CLI from a test is a process spawn, which the in-process gate forbids                                                                                                                                                                                                                                             |
| `bench-decisions.integration.test.ts` (changed: one compile-forced line)                                                  | integration      | delete                                             | it feeds hand-built inputs to pure workflows and asserts decision fields (CONST-T12, T14), so under the testing law it is not an integration test; a compliant rewrite runs the bench CLI on a real corpus, which is the Bench lane itself                                                                                     |
| `readBenchRun` laws re-homed from it: cost sum, undecodable line number, verdict count, phase durations carried or absent | workflow         | admit                                              | summing only the last cost; numbering lines from 0 or skipping blanks; accepting two verdicts; dropping `reporting`                                                                                                                                                                                                            |
| `coveringTestFiles` laws re-homed from it: sorted deduped holders, non-JSON text refused                                  | workflow         | admit                                              | listing a test file twice or unsorted; a malformed report read as empty                                                                                                                                                                                                                                                        |
| corpus empty-repo refusal                                                                                                 | schema           | refuse                                             | `bench-corpus.schema.ts` is unchanged by this PR, so its refusal is out of scope; its `NonEmptyArray` (`bench-corpus.schema.ts:16`) and the product's `corpus-unreadable` abort stand; the legacy-line `not-recorded` decode is pinned by `packages/stryker-js-cli-contract/tests/run-event-wire-line.integration.test.ts:336` |
| in-source refusal properties (U10), one block per refined file                                                            | schema           | admit (pack rule `refusals-beside-generated-laws`) | a refinement widened (`NonEmptyString` to `String`, `>= 0` dropped, a literal set extended) while every generated accept-law stays green                                                                                                                                                                                       |
| `settle-run-path` law (U7)                                                                                                | workflow         | edit: tagged outcomes                              | a restore failure swallowed when the run also failed, or a cause replaced by its text                                                                                                                                                                                                                                          |

### Verification

- Local: `dprint check`, `tsc -b` in `test/e2e-core` and `test/bench`, `oxlint` and `lint:tsgo` on changed packages, `vitest run` in `test/e2e-core` and `test/bench` (each package's own unit suite, not the e2e lane).
- CI: the PR's own checks on the exact head, with no Bench check (AE1).
- A/A: one `workflow_dispatch` of `bench.yml` on the PR head; from its artifacts, every leg `summarized`, one project root per leg, equal inputs and mutant-id digests across sides, no `total` regression (AE7).
- Refusal properties (U10): each property's independent predicate is written from the domain sentence, and every draw carries the boundary seeds. The pack's "widen the refinement once" check is not run, because root's 2026-10-13 intent forbids hand-applied probes. The full-path re-review judges the properties instead.

### Risks

- **Registry-resolving enterprise install without a deadline.** `test/bench/src/prepare-side.service.ts:490-506` still runs `npm install --before=<lock time>`. With the 7.5-minute deadline gone, a bad upstream publish that makes npm loop (the `@effect/opentelemetry@4.0.3` peer on then-unpublished `effect@4.0.3`; `effect@4.0.3` is published as of 2026-10-12, `npm view effect@4 version`) would run the enterprise leg on main to the 60-minute backstop instead of aborting at 7.5 minutes on every PR. Postsubmit-only and bounded; owned by layer 2 (KD9).
- **Job killed at 60 minutes leaves no `bench-report.json`.** The job's timeout conclusion is the only signal (KTD5).
- **`workflow_dispatch` on an old ref runs that ref's `bench.yml`.** Dispatch is meaningful only on refs containing this layer.
- **One comparison per commit is noisy.** Postsubmit benchmarking elsewhere leans on history across commits (conbench benches main commits plus on-request PR runs, https://conbench.github.io/conbench/pages/benchmarking_and_the_dev_process.html; MongoDB uses change-point detection over history, https://arxiv.org/abs/2003.00584). This lane compares one commit to one parent; KD5's non-overlap plus floor is the false-positive control, and the lane is report-only.
- **A commit that changes the stream contract gets no comparison (known limit).** Both sides' NDJSON is decoded with the checkout's `RunEvent` (`read-bench-run.workflow.ts:2`). When a main commit changes the wire format, as #298 does, side A's stream is `stream-undecodable`, the leg is `failed` (exit 1, `::error Bench invalid`) and that SHA has no comparison. Accepted for this layer by the sub-conductor ruling of 2026-10-12. The follow-up boundary is decoding each side with its own side's contract; it is a separate unit, not part of layer 1 or layer 2.
