---
title: E2E Postsubmit on Main and One 60-Minute Backstop - Plan
type: ci
date: 2026-10-11
topic: e2e-postsubmit
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# E2E Postsubmit on Main and One 60-Minute Backstop - Plan

## Goal Capsule

- **Objective:** A pull request's checks no longer wait on the scripted e2e lane, every push to main still runs all five e2e legs, a red main run names the commit range and the action for root, and no CI step or job is killed before a single 60-minute backstop.
- **Means:** move the e2e legs from `.github/workflows/ci.yml` into their own push-to-main workflow, set every `timeout-minutes` outside `bench.yml` to 60, and delete the step-level `timeout` wrappers named in R13.
- **Product authority:** the root ruling of 2026-10-11 (this unit's contract). It grants edits under `.github/workflows/`, which the repo `AGENTS.md` Boundaries table lists as read-only. Scope is workflow YAML, the deletions in `test/e2e/tests/__fixtures__/bake-fixtures.sh`, and the doc lines in R21.
- **Open blockers:** none.

---

## Product Contract

### Summary

A new `e2e.yml` workflow runs today's five e2e legs on every push to main and on dispatch, and `ci.yml` loses its e2e job.
A red main run writes the culprit range and a reason code, and every leg reports its wall time against a 10-minute target without failing on it.
Every job and step cap outside `bench.yml` becomes 60 minutes, and the mutation wall-clock budget becomes a warning.

### Problem Frame

The e2e legs run on every pull request (`ci.yml:305-381`).
The five legs together used 42.0 runner-minutes on run 38124123027 and 52.3 on run 38121199453.
Main has no required status checks, so moving the legs off PRs blocks no merge.
In each of the last 10 completed PR CI runs, though, the critical path was `check` (15.9-22.7 min), not the slowest e2e leg (11.0-15.8 min; Appendix A).
So PR wall time barely moves; what changes is runner time and which signal gates a PR.
Separately, several step-level `timeout` wrappers and job caps of 8-45 minutes kill work early, turning a slow run into a red one.

### Key Decisions

- KD1. **The postsubmit workflow builds for itself.** The e2e legs reuse nothing from `check` today. They restore no Turbo cache, and `pnpm test:e2e` runs the `test:e2e` Turbo task (`turbo.json:81-84`, `cache: false`, `dependsOn: ["^build"]`), which builds every dependency inside each leg. Sharing `check`'s Turbo entry is not possible on main anyway: `check` runs in parallel and saves `turbo-Linux-dist-<sha>` only at its end. Governs R5.
- KD2. **No docs-only skip on main.** Today `e2e` needs `lane` and skips docs-only changes (`ci.yml:306-307`). The contract forbids path filters that skip e2e on a main push, so the new workflow drops that gate, and docs-only main pushes now run e2e. Governs R4.
- KD3. **The first run reports no previous run and falls back to nothing.** The old lane's history in `ci.yml` is not used: it ran on PR merge refs and skipped docs-only commits, so its result does not compare. Governs R9.
- KD4. **checker-parity's run deadline goes; its plan deadline stays.** `run --deadline` is optional and the driver runs unbounded without it. `plan --deadline` is required and sizes the legs (Appendix B, answer 5). Governs R15.
- KD5. **The mutation budget becomes a warning in YAML alone.** mutation.yml's gate step passes only `--budget-baseline`, so the step's exit code already isolates the budget verdict, and no product change is needed (Appendix B, answer 6). Governs R18, R19.

### Requirements

**The PR path**

- R1. No workflow triggered by `pull_request`, `pull_request_target` or `merge_group` runs `pnpm test:e2e` or any `tests/*.e2e.test.ts`. A grep over `.github/workflows` on the PR head shows it, and so does the PR's own check list.
- R2. `ci.yml` loses the `e2e` job and everything that exists only for it: the job block, its comment at `ci.yml:352-354`, and its job-level env. `lane`, the workflow-level `PARITY_DEADLINE` and the other jobs stay; none of them needs `e2e` (Appendix B, answer 1).
- R3. The PR body lists, by number, every open PR whose workflow diff would put e2e back on PRs, citing that diff (Appendix C).

**The postsubmit workflow**

- R4. `.github/workflows/e2e.yml` fires on `push` to `main` and on `workflow_dispatch`, with no path filter.
- R5. It runs today's five legs (`lifecycle`, `sabotage`, `svelte-composite`, `rest-1`, `rest-2`) with today's files, excludes, env, telemetry export and artifact upload (`ci.yml:308-381`), minus the wrapper deleted in R13.
- R6. Concurrency is `group: e2e-${{ github.sha }}` with `cancel-in-progress: false`.
- R7. It skips release commits with today's expression, `github.event_name != 'push' || github.event.head_commit.author.username != 'github-actions[bot]'` (`ci.yml:307`, minus the docs-only clause per KD2).
- R8. Permissions are read-only: `contents: read` and `actions: read`, with no write scope, and the workflow never reverts anything.

**Red main run report**

- R9. When any leg of a run on `refs/heads/main` does not succeed (failure, cancelled or timed out), the step summary and one `::error` carry five things: this SHA; the previous main e2e run's SHA and conclusion; the commit range between them; a reason code; and the next action `root opens a revert PR of the culprit squash commit or a root-fix P0`. With no previous run, the report says so and the range is this commit alone.
- R10. The previous main e2e run is the newest completed run of `e2e.yml` on `main` whose head SHA is a strict ancestor of this SHA and whose legs ran. Cancelled runs, release-skipped runs and in-progress runs do not count, and a dispatch of an old SHA never takes a newer commit as its "previous". It is read from the Actions runs API, with ancestry from the compare API.
- R11. The commit range comes from the compare API between the previous SHA and this SHA. Each squash commit in it is listed as a culprit candidate.
- R12. Reason codes separate three cases: red after green, red after red (the culprit may predate the range), and red with no previous run.

**Time caps**

- R13. Three step-level kills are deleted: the `timeout ... 1200` wrapper on the E2E lane (`ci.yml:357`), the `timeout ... "$BUDGET"` wrapper on checker-parity's run step (`ci.yml:614`, with its now-unused `BUDGET` env at `ci.yml:606`), and the 300 s `timeout` in `test/e2e/tests/__fixtures__/bake-fixtures.sh`. That script loses only `INSTALL_LIMIT_SECONDS`, `KILL_AFTER_SECONDS`, the `timeout` prefix and the overrun message. Its `--min-release-age=1` age gate and its two `npm install` calls stay.
- R14. Every `timeout-minutes` in `.github/workflows/*.yml` except `bench.yml` becomes 60. That includes the step-level `ci.yml:604`, the expression-valued `ci.yml:544`, kill-matrix's 120 (`kill-matrix.yml:111`; its longest job in the window was 13.7 min) and the new e2e jobs (Appendix B, answer 4).
- R15. checker-parity's `run` step drops `--deadline "$DEADLINE"` and the `DEADLINE` env (`ci.yml:607`, `ci.yml:620`). `PARITY_DEADLINE` (`ci.yml:19`) stays for `plan --deadline` (`ci.yml:517`).
- R16. The exit-124 branch that only the deleted `ci.yml:614` wrapper could feed (`ci.yml:638-640`, code `shard-timeout`) is removed or reworded, so no annotation claims a step budget that no longer exists (Appendix B, answer 7).

**Leg wall time**

- R17. Each e2e leg writes its wall time and the 10-minute target to its step summary. An overrun adds a `::warning` and never changes the job's outcome.

**Mutation budget**

- R18. When `stryker gate --budget-baseline` exits 1 (`BudgetExceeded`, the 701 s budget = 561.078 s × 1.25), mutation.yml's gate step writes the actual and allowed seconds to the step summary and a `::warning`, and succeeds.
- R19. Any other exit of that step still fails the job, including exit 2 (`BudgetInputUnusable`). The score verdict (`thresholds.break`) and the survivor baseline verdict are not touched.

**Evidence and docs**

- R20. The PR body carries the before numbers in Appendix A (the last 10 PR CI runs from the jobs API: workflow wall time and slowest e2e leg against `check`). It also lists every other in-repo time cap, unchanged (Appendix D). It says the root ruling grants the `.github/workflows/` edits that `AGENTS.md` marks read-only.
- R21. One line in `test/e2e/AGENTS.md` or `test/e2e/README.md` says e2e runs postsubmit on main. The sentence about the 300 s install `timeout` at `test/e2e/README.md:14` goes, because R13 makes it false.

### Acceptance Examples

- AE1. **Covers R1, R2.** Given the PR head, when `.github/workflows` is grepped for `test:e2e` and `.e2e.test.ts`, then every match is in `e2e.yml`, which has no `pull_request`, `pull_request_target` or `merge_group` trigger, and the PR's check list shows no `e2e (...)` job.
- AE2. **Covers R9, R10, R12.** Given a main push whose `rest-1` leg fails while the previous main run on an earlier SHA succeeded, when the run ends, then the summary and one `::error` name both SHAs, `success`, the compare range, the red-after-green code and the next action.
- AE3. **Covers R9.** Given the first `e2e.yml` run on main is red, when the report step runs, then it states that no previous main e2e run exists and gives this SHA as the range.
- AE4. **Covers R17.** Given a leg that took 12 m 30 s and passed, then its summary shows the wall time and the 10 m target, a `::warning` names the overrun, and the job is green.
- AE5. **Covers R18, R19.** Given a merged report whose budget records 750 s, when the gate step runs, then it is green with a `::warning` naming 750 s against 701.3 s. Given a report with no budget field, the step exits 2 and fails.

### Scope Boundaries

- No PR-only smoke copy of e2e, no nightly cron, no cancel-in-progress on main, no path filter on main, no raised cap, and no change to `bench.yml`.
- No product-code change and no bake-machinery change beyond R13's deletions. The harness, `test/e2e/vitest.config.ts` and the `lgtm:up` `timeout 180` (`package.json:35`) keep their caps; R20 lists them unchanged.
- No automatic revert, and no rerun or retry logic.
- mutation.yml's kill-matrix and verdict-store logic and the checker-parity driver code are untouched beyond R14-R16 and R18-R19.

### Outstanding Questions

**Deferred to Planning**

- How R17 is wired: the existing `job-report` action (`started-at` input, `.github/actions/job-report/action.yml`) plus one warning step, or a leg-local step. The measured time starts at the first step, so it excludes queue time.
- Whether `checker-parity-report`'s message at `ci.yml:763`, which names `shard-timeout`, needs the same rewording as R16.
- Deleting lines from `bake-fixtures.sh` changes the packed-closure key (`test/e2e/README.md:40`), so the first postsubmit run on main rebakes every fixture. Planning confirms that this cold bake fits the 60-minute cap: today's legs run 6-16 min with a warm bake.

---

## Appendix

### Appendix A. Before numbers: last 10 completed PR CI runs

From `GET /repos/systemfsoftware/stryker-js-effect/actions/runs/<id>/jobs` on 2026-10-11. Wall time runs from the first job start to the last job end. All 10 runs concluded `failure`, on main's contract-version law that #300 fixed.

| Run         | Branch                        | Wall (min) | Slowest e2e leg (min) | `check` (min) | Critical path |
| ----------- | ----------------------------- | ---------- | --------------------- | ------------- | ------------- |
| 38124123027 | fix/hermetic-e2e-bake         | 17.1       | rest-1 11.0           | 16.9          | check         |
| 38121199453 | fix/manifest-document-keys    | 21.0       | rest-1 14.2           | 20.9          | check         |
| 38115782339 | fix/hermetic-e2e-bake         | 17.4       | rest-1 11.7           | 17.3          | check         |
| 38113206204 | stryker/tsgo-checker-shortcut | 22.6       | rest-1 13.8           | 22.5          | check         |
| 38113164842 | stryker/mutant-quality-l6     | 16.7       | rest-1 13.0           | 16.6          | check         |
| 38111088500 | stryker/mutant-quality-l5     | 16.2       | rest-1 13.9           | 15.9          | check         |
| 38110293096 | stryker/tsgo-checker-shortcut | 24.3       | rest-1 14.4           | 22.7          | check         |
| 38108376853 | ci/mutation-digest-scope      | 22.7       | rest-1 15.8           | 22.6          | check         |
| 38107603751 | stryker/tsgo-checker-shortcut | 22.0       | rest-1 14.1           | 21.8          | check         |
| 38105886612 | fix/plan-shards-lpt           | 16.5       | rest-1 13.9           | 16.4          | check         |

### Appendix B. Answers the contract asked to settle

1. **What needs or reads e2e, and what it reuses from check.** Nothing needs or reads `e2e`. The only `needs:` edges are `check` on `lane` (`ci.yml:58`), `cache-sweep` on `check` (`ci.yml:242`), `checker-parity` on `checker-parity-changes` (`ci.yml:536`), and `checker-parity-report` on both of those (`ci.yml:674`). There is no aggregator or summary job. `e2e` needs only `lane`, for the docs-only skip (`ci.yml:306-307`). It reuses nothing from `check`: it does its own install (`ci.yml:332-340`), restores no Turbo cache, and builds through `test:e2e`'s `^build` (`turbo.json:81-84`).
2. **The release-commit skip today.** `if: needs.lane.outputs.docs-only != 'true' && (github.event_name != 'push' || github.event.head_commit.author.username != 'github-actions[bot]')` (`ci.yml:307`).
3. **Where (c) and (d) read their numbers.** (c) takes this SHA from `github.sha`. Per-leg conclusions come from the jobs API of the current run. The previous run comes from `GET /actions/workflows/e2e.yml/runs?branch=main&status=completed`, filtered per R10. The range comes from `GET /compare/<prev>...<this>`. All of these need only `actions: read` and `contents: read`. (d) takes an epoch recorded by the leg's first step, the pattern `check` already uses (`ci.yml:66-67`), and compares it with the clock at an `if: always()` last step.
4. **kill-matrix's longest job over the last 30 days: 13.7 min.** That is `Kill matrix / kill-matrix · shard 4/20` in run 38091732059. The window holds 332 jobs across 16 runs, from 2026-10-10 to 2026-10-11, because the workflow is two days old. 13.7 ≤ 45, so `kill-matrix.yml:111` becomes 60.
5. **Whether the parity driver needs `--deadline`.** `run` does not. The flag is `Flag.optional` (`test/checker-parity/src/main.ts:492-495`). An absent value leaves `deadlineAt` as `None` (`test/checker-parity/src/run-side.ts:1547`), `isPastDeadline` is false for `None` (`run-side.ts:489`), and a batch runs with no timeout (`run-side.ts:598-600`). `plan` does need it: the flag is required (`main.ts:516-518`) and becomes shard capacity (`main.ts:363`), fed from `PARITY_DEADLINE` at `ci.yml:517`.
6. **Whether the CLI flags separate the budget verdict from the score and baseline verdicts.** Yes, in the pinned published CLI (flake input `stryker-published` = `9e81669b8`, run as `$PUBLISHED_CLI` at `mutation.yml:37`). In `packages/stryker-js/src/run-request.cell.ts` at that commit, `gateReport` runs the survivor gate only when `--baseline` is given (line 472) and the budget gate only when `--budget-baseline` is given (lines 406, 492). mutation.yml passes only `--budget-baseline` (`mutation.yml:335`, `mutation.yml:338`), so that step is the budget verdict alone. `BudgetExceeded` has exit class `VerdictFail`, exit 1 (`packages/stryker-js/src/budget-gate.workflow.ts:10`, `:41`; `packages/stryker-js-plugin-interface/src/ExitClass.schema.ts:11-16`). `BudgetInputUnusable` and `GateInputUnusable` (an unreadable report) are `ConfigError`, exit 2 (`budget-gate.workflow.ts:57`; `packages/stryker-js/src/gate-new-survivors.workflow.ts:79`). The only other exit-1 failure, `GateRejected` (`gate-new-survivors.workflow.ts:61`), needs `--baseline`, which this step never passes. So in this step exit 1 means `BudgetExceeded` and nothing else. The 701 s figure is `.stryker/budget-baseline.json`'s 561.078 s times the default 1.25 tolerance.
7. **What reads exit 124 from the deleted wrappers.** One reader: `ci.yml:636-640`, the `if: failure()` step after checker-parity's run step, maps `EXIT` 124, 137 or empty to `shard-timeout`. Only the `ci.yml:614` wrapper produces 124. After the deletion, the empty case is still reachable: a step that hits its own `timeout-minutes` (`ci.yml:604`) fails before `echo "exit=..."` runs. The 124 and 137 cases and the message's "step budget" wording go dead. The `ci.yml:357` wrapper's exit is read by nothing: the next steps are `if: always()` telemetry. The bake script's exit reaches the harness only as non-zero (`test/e2e/src/Harness/fixture-cache.service.ts:137-141`); nothing matches 124.

### Appendix C. Open PRs and e2e on PRs

Read from each open PR's files API on 2026-10-11 (21 open PRs).

- Edit the `e2e` job in `ci.yml`, so a merge after this PR conflicts, and keeping their hunk puts e2e back on PRs: #271 (`stryker/verdict-store`, adds a verdict-store leg and edits the rest excludes), #285 (`fix/hermetic-e2e-bake`, adds the `Bake report` step and `STRYKER_E2E_BAKE_RECORD`), #291 (`ci/wall-clock-u4`, adds two typescript-checker legs and rewrites the leg's steps).
- Edit `ci.yml` outside the `e2e` job: #286 (no e2e lines) and #288 (an e2e-core path in a mutation build key).
- #289 changes only `mutation.yml` (`test/e2e-core/reports/stryker-verdicts`, push and dispatch only). #298 changes no workflow; it edits `test/e2e/tests/failing-run.e2e.test.ts`, which after this PR runs postsubmit. Neither puts e2e on PRs.

### Appendix D. Other in-repo time caps, unchanged

Confirmed so far; planning completes the list for the PR body:

- `test/e2e/vitest.config.ts:3-4`, `:13-15`: `testTimeout` 120 s, `hookTimeout` 600 s, `teardownTimeout` 30 s.
- `package.json:35`: `lgtm:up` waits with `timeout 180`.
- `test/e2e/src/Harness/warm-sandbox.handle.ts:53-54`: sandbox stop 10 s, kill 5 s.
- `test/e2e/scripts/seed-status-fault.ts:10-14`: lane 1500 s, install 900 s (a local script, not CI).
- `test/e2e/scripts/export-traces.ts`: settle wait and 1 s poll.
- `mutation.yml:34` `TARGET_SECONDS: 200` sizes shards; it kills nothing.
