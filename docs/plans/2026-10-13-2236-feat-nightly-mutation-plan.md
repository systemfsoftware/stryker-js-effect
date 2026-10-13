---
title: Nightly-Only Mutation With A Same-Run Drop Audit - Plan
type: ci
date: 2026-10-13
topic: nightly-mutation
artifact_contract: ce-unified-plan/v1
product_contract_source: root-order
execution: code
supersedes: docs/plans/2026-10-13-2152-feat-nightly-mutation-plan.md
---

# Nightly-Only Mutation With A Same-Run Drop Audit - Plan

## Goal Capsule

- **Objective:** Mutation runs once a night and on dispatch, never on a push or a pull request. Each such run that builds a kill matrix also audits it in the same run, and the corpus is every shipped package that holds a `*.workflow.ts`.
- **Means:** `.github/workflows/mutation.yml` keeps `schedule` and `workflow_dispatch` and drops `push`, with every clause that only a push could satisfy. The `kill-matrix` job runs on the schedule and on every dispatch. A new `drop-audit` job needs `kill-matrix` and audits that run's `kill-matrix-${{ github.run_number }}`. `packages/stryker-js-instrumenter` and `packages/stryker-js-html-reporter` join the corpus. A `# Cost:` header at line 1 states the lane's measured runner-minutes per day.
- **Supersession (2026-10-13 21:30):** this plan replaces `docs/plans/2026-10-13-2050-feat-nightly-mutation-plan.md`. The full-path review of PR #351 at `df974424` (run `20261013-210937-ba30cb17`) confirmed five findings, fixed here: `drop-audit`'s failures gave no workspace-root reproduce command and its matrix check had no `id` (pack rule `ci-wall-clock/failures-name-the-gate-and-location.md`); `MATRIX_MISSING` blamed a failed lane for a failed download; the exit-2 next action named an audit output that stderr never reached; the `lane` input's description omitted the audit; and the cost-header line ranges were `1-16` where the headers end at line 19 (`mutation.yml`) and 22 (`bench.yml`).
- **Supersession (2026-10-13 21:52):** this plan replaces `docs/plans/2026-10-13-2130-feat-nightly-mutation-plan.md`. The full-path review of `1909c335` (run `20261013-213150-98d4190e`) confirmed eight findings, fixed here: the `audit` step lost its `status` output under GitHub's `bash -eo pipefail`, so `DROP_AUDIT_REFUSED` was unreachable; the verdict's hand-kept step list omitted `start`, so that step's failure read as OK; an audit exit other than 1 or 2 read as a failed drop; `MATRIX_MISSING`'s reproduce was a download of an artifact the failed lane never published; the verdict and matrix-check logic shipped with no committed test (now `scripts/drop-audit-verdict.ts` and its test); a ref-keyed `concurrency` group let a later run replace a pending one; `INCREMENTAL_REPORTS` was a fourth, unguarded copy of the corpus; and the build-cache key was written three times (now `.github/actions/mutation-build-key`).
- **Supersession (2026-10-13 22:36):** this plan replaces `docs/plans/2026-10-13-2152-feat-nightly-mutation-plan.md`. The full-path review of `6787207e` (run `20261013-215320-77ed7faf`) confirmed four findings, fixed here: the test re-declared `scripts/assert.ts`'s helpers; `Verdict.reason` was a bare `string` beside the closed `MatrixReason`, now the closed `DropAuditReason`; the failure loop asserted only that a command was present, so a swapped `install`, `build` or `upload` code stayed green, and each row now asserts its code; `stepsOf` had no test. The validator rejected six: the audit's unjoinable-drop semantics and the writer/judge CLI skew (CLI source unchanged since #276), the step-order pin (a workflow-text test), the cost header (it already names the unmeasured share), the fixed corpus list (pre-existing on `b08379dd`), and the removed push trigger (the house law).
- **Product authority:** the root's order of 2026-10-13: nightly schedule plus `workflow_dispatch` only; the #288 drop audit with `needs: [kill-matrix]` on the same run's `kill-matrix-${{ github.run_number }}`; "enroll every package containing *.workflow.ts including stryker-js-instrumenter and stryker-js-plugin-interface; list packages with no workflow files" (verbatim; KD3 records why plugin-interface, which holds none, is listed rather than enrolled, and the PR body reports that correction to the root); a measured cost header in the shape of `bench.yml:1`, for the reason the #333 review gave; no local mutation; one independent PR off current `main`.
- **House law:** Ryan's nightly-only mutation law of 2026-10-12: mutation runs only nightly or on manual dispatch on `main` CI, never on a push or a pull request, and never on a local machine.
- **Edit scope:** `.github/workflows/mutation.yml`; `.github/workflows/kill-matrix.yml` (the two `projects` defaults, the deleted ref-keyed `concurrency` block and the `build` job's key step); the new `.github/actions/mutation-build-key`; the new `scripts/drop-audit-verdict.ts` and its test; the two enrolled packages' `stryker.config.ts`, `package.json` and `tsconfig.node.json`; `pnpm-lock.yaml`; one changeset and this plan. No change to the kill-matrix lane's shards, plan or collect, the verdict store, `ci.yml`, `test/e2e-core` or the three existing configs.
- **Workflow ownership (CONST-E9 here, CONST-E7 in the org's constitution):** `AGENTS.md` makes `.github/workflows/` read-only to agents. The root, who owns it, ordered this workflow change, so this unit edits `mutation.yml` and `kill-matrix.yml` on the branch. Every workflow hunk is listed under Planning Contract, "Workflow hunks".
- **Verification without mutation:** nothing here starts Stryker. Branch evidence is parsed workflow YAML, typechecked configs, a frozen install, `lockfile-closure-digest.integration.test.ts` (it reads `mutation.yml`'s `PROJECTS`), `scripts/drop-audit-verdict.test.ts`, the repo gates and a full-path `ce-code-review`. The first nightly or dispatched run on `main` is the first run of the new jobs.

## Product Contract

### Problem Frame

- `mutation.yml:3-24` starts the lane on every non-docs push to `main`, on dispatch and at `17 3 * * *`. The house law allows only the last two.
- The kill-matrix lane runs only on a non-bot push or a `lane=kill-matrix` dispatch (`mutation.yml:381`). The last three scheduled runs, 38239240750, 38130563737 and 38042987222, published no `kill-matrix-<n>`. #288's recorded answer (closure item C1, https://github.com/systemfsoftware/stryker-js-effect/pull/288#issuecomment-6140435041) requires the schedule arm in the same change that removes `push`; without it no matrix is ever published again.
- #288 audits the newest matrix of a completed earlier `main` run. A push's own Mutation run is still running when that audit runs, so the audit judges the previous matrix (#288's T3). A job in the run that builds the matrix judges that matrix.
- The corpus is three packages (`mutation.yml:36`). Two more shipped packages hold `*.workflow.ts` and are not graded.
- `mutation.yml:1` is `name: Mutation`. No line states what the lane costs. The #333 review (run `20261013-170535-66c6722d`, finding #6, "Mutation heavy lane's cost changed with no runner-minutes header", pack rule `ci-wall-clock/heavy-lanes-state-their-daily-minutes`) found it; the validator rejected the finding only because `mutation.yml` was outside #333's diff. This PR edits `mutation.yml`, so it carries the header.

### Requirements

- R1. `mutation.yml`'s triggers are `schedule` (`17 3 * * *`, unchanged) and `workflow_dispatch` (inputs `full` and `lane`, unchanged). There is no `push` and no `pull_request`.
- R2. Every expression only a push could satisfy is gone: `paths-ignore`, the release-bot `concurrency.group` switch, and the `head_commit.author.username` clauses in the `plan`, `build` and `kill-matrix` conditions. Neither `mutation.yml` nor `kill-matrix.yml` keeps a `concurrency` group: each scheduled and dispatched run is its own, so no run replaces a pending one (pack rule `ci-wall-clock/heavy-suites-judge-every-main-commit.md`, Concurrency: a dispatch takes a group of its own).
- R3. The kill-matrix lane runs on every scheduled run and every dispatch. `lane: all` runs the scoring lane, the kill-matrix lane and the drop audit. `lane: kill-matrix` runs the kill-matrix lane and the drop audit.
- R4. A `drop-audit` job with `needs: [kill-matrix]` audits the artifact `kill-matrix-${{ github.run_number }}` that run's `collect` job uploaded. It fails closed when the kill-matrix lane failed, when its artifact did not come down, when the artifact lacks a project of the corpus, and when `stryker audit` exits non-zero. Every step carries an `id`; a `verdict` step maps the first failed step to a reason code from a closed set, with the next action and a command that reproduces the failure from the workspace root, and `job-report` writes the annotation and the summary. It uploads `audit.json` as `drop-audit-${{ github.run_number }}`.
- R5. `mutation.yml` line 1 begins a `# Cost:` header in the shape of `bench.yml:1-22`: runner-minutes per day, the run shape that prices, per-run job-minutes with the run ids behind them, the 7-day first-parent merge count with its window, the rejected push counterfactual labelled as such, and the #333 finding as the reason the header exists.
- R6. The corpus is every shipped workspace package holding a `*.workflow.ts` outside `__tests__`: `packages/stryker-js`, `packages/stryker-js-typescript-checker`, `packages/stryker-js-vitest-runner`, `packages/stryker-js-instrumenter` and `packages/stryker-js-html-reporter`. `mutation.yml`'s `PROJECTS` and both `projects` defaults in `kill-matrix.yml` list all five; `INCREMENTAL_REPORTS` is the glob `packages/**/reports/stryker-incremental.json`, so it holds no copy of the list.
- R7. The PR body and this plan list every workspace package left out, with the reason (table below).

### Who is left out, and why (R7)

Measured with `git ls-files '*.workflow.ts'` on `b08379dd`, `__tests__` excluded.

| Package                                                                                                                                                                         | `*.workflow.ts` files | Reason                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/stryker-js-plugin-interface`                                                                                                                                          | 0                     | Holds no workflow file (its `src` is schemas, services and `mod.ts` files). The root's order named it; the order's own rule, "every package containing `*.workflow.ts`", leaves it out. Enrolled, its mutate set would be empty, and an empty mutate set scores Unscored and exits 0, a silent pass (#333 review). |
| `packages/stryker-js-cli-contract`, `packages/stryker-js-plugin-runtime`                                                                                                        | 0                     | No workflow file.                                                                                                                                                                                                                                                                                                  |
| `packages/frameworks/angular`, `packages/frameworks/interface`, `packages/frameworks/svelte`                                                                                    | 0                     | No workflow file.                                                                                                                                                                                                                                                                                                  |
| `packages/ignorers/angular`, `packages/ignorers/effect-schema-declarations`, `packages/ignorers/in-source-vitest-block`, `packages/ignorers/interface`, `packages/ignorers/kit` | 0                     | No workflow file.                                                                                                                                                                                                                                                                                                  |
| `packages/toolchain/oxlint-ignorer-config`, `packages/toolchain/stryker-config`, `packages/toolchain/tsdown-config`, `packages/toolchain/vitest-config`                         | 0                     | No workflow file.                                                                                                                                                                                                                                                                                                  |
| `test/e2e`                                                                                                                                                                      | 0                     | No workflow file.                                                                                                                                                                                                                                                                                                  |
| `test/bench` (6), `test/checker-parity` (8), `test/e2e-core` (12)                                                                                                               | 26                    | Test tooling, not shipped products: #337 (`3797debd`) grades only shipped products and took `test/e2e-core` out of the corpus.                                                                                                                                                                                     |

### Key Decisions

- KD1. **The house law outranks the pack's push rule.** `ci-wall-clock/heavy-suites-judge-every-main-commit` asks for a heavy suite to judge every push to `main`. Ryan's nightly-only law of 2026-10-12 forbids a mutation run on a push. Rejected: keep `push`. Reason: house law, restated in the root's order. The cost header prices the nightly run and labels the push shape as a rejected counterfactual, which is how `heavy-lanes-state-their-daily-minutes` asks a non-push run shape to be stated.
- KD2. **The drop audit lives in `mutation.yml`, after `kill-matrix`, on the same run's artifact.** #288's recorded answer recommended a separate workflow on `workflow_run` and warned that a copy of the job inside `mutation.yml` duplicates a judgment surface. Rejected: that separate workflow. Reason: the root's order. The same-run download needs no cross-run lookup, no `actions: read` and no 100-run scan. Consequence, the root's tradeoff: while #288's `ci.yml` job (T1/T2) is open, the job is defined twice; whichever lands second carries the duplication for the root to resolve.
- KD3. **`plugin-interface` is not enrolled** (table above). Rejected: enroll it because the order named it. Reason: the order's rule excludes it, and its mutate set would be empty.
- KD4. **The instrumenter's config resolves its workspace `effect-schema-declarations` ignorer.** `packages/stryker-js-instrumenter/package.json` already holds `@systemfsoftware/stryker-ignorer-effect-schema-declarations: workspace:^` for `tests/effect-schema-declarations-ignorer.integration.test.ts:10`, and one key cannot also hold the published tarball. The workspace package and the published tarball are both 0.3.0, with the same `stryker-ignorer-interface ^0.1.2` and `stryker-ignorer-kit ^0.1.2` ranges. Turbo builds it through `^build`. Rejected: install the published tarball under an npm alias, a second name for one package that this repo uses nowhere. Risk: once the workspace ignorer's source moves past the release, the instrumenter is graded with the newer ignorer.
- KD5. **The corpus list is written in three places, and the audit catches a divergence.** `mutation.yml`'s `PROJECTS` and the two `projects` defaults in `kill-matrix.yml:9,15`: a reusable-workflow call's `with:` cannot read `env`, so `kill-matrix.yml` keeps its own defaults. The drop audit checks the downloaded matrix against `mutation.yml`'s `PROJECTS` and fails with `MATRIX_INCOMPLETE` on a missing project, so a divergence turns the run red instead of narrowing the audit. `INCREMENTAL_REPORTS`, a fourth unguarded copy at `df974424`, is now a glob.
- KD6. **Off current `main`, with known file overlap.** #289 (`stryker/verdict-store-ci`) edits `mutation.yml` and #271 (`stryker/verdict-store`) edits `kill-matrix.yml`. The OP13b overlap check exits 1. The root ordered this PR independent, off current `main`. Their hunks are the verdict store's, and whichever PR merges second merges the other's change in.

## Planning Contract

### Measured cost (R5)

Per-run minutes are the sum of the run's job wall times, read from the jobs API on 2026-10-13.

- **Scoring lane, scheduled (`--full`):** runs 38384850859 (47.7), 38239240750 (43.5), 38130563737 (44.5) and 38042987222 (161.5). Median 46.1, range 43.5-161.5.
- **Kill-matrix lane:** 15 completed `main` push runs, 38290483095 (2026-10-12T18:22Z) through 38456457178 (2026-10-13T19:38Z). Median 209.0, range 187.2-297.0. Its wall time has a median of 34.7 minutes.
- **Drop audit:** #288's `drop-audit` job took 0.97 job-min (run 38344422811) and 0.67 (run 38366579884), with the Mutation build cache restored.
- **Nightly price:** about 256 runner-min/day (231-459), one scheduled run a day. Measured on the three-project corpus. The instrumenter and the HTML reporter add a share that the first nightly run measures.
- **Rejected counterfactual, the push trigger this PR removes:** 115 first-parent commits on `main` from 2026-10-06T20:00Z to 2026-10-13T20:00Z (16.4 a day). The 12 completed push runs of 2026-10-13 took 4,006 job-min. Push runs per day 2026-10-06 to 2026-10-12: 19, 14, 11, 14, 20, 2, 11.

### Workflow hunks

- `mutation.yml` lines 1-19: the `# Cost:` header (R5).
- `mutation.yml` `on:`: `push` with its `paths-ignore` deleted; `workflow_dispatch` and `schedule` unchanged.
- `mutation.yml` `concurrency:` deleted, and `kill-matrix.yml`'s `concurrency:` (`group: kill-matrix-${{ github.ref }}`) with it (R2).
- `mutation.yml` `env:`: `PROJECTS` lists five projects and `INCREMENTAL_REPORTS` is `packages/**/reports/stryker-incremental.json`; `PROJECTS` is still one line under top-level `env:` (the shape #288's corpus reader and `lockfile-closure-digest.integration.test.ts:112-116` parse).
- `mutation.yml` `plan` and `build` `if:`: `github.event.inputs.lane != 'kill-matrix'` alone.
- `mutation.yml` `kill-matrix` job: its `if:` is deleted, so it runs on every schedule and dispatch.
- `mutation.yml` new `drop-audit` job (below).
- `kill-matrix.yml:9,15`: both `projects` defaults list the five projects.

### `drop-audit` job

`needs: [kill-matrix]` with `if: ${{ !cancelled() }}`, so a failed kill-matrix lane still reaches steps 4-5 and reports `MATRIX_MISSING` instead of a skipped job; `runs-on: ubuntu-latest`, `timeout-minutes: 60`, `permissions: contents: read`. Env: `MATRIX_DIR: kill-matrix`, `MATRIX_ARTIFACT: kill-matrix-${{ github.run_number }}`, `AUDIT_OUT: reports/audit.json`.

1. Record the start time (`start`).
2. `checkout`; `build-key`, from the composite action `.github/actions/mutation-build-key`, which `mutation.yml`'s `build` job and `kill-matrix.yml`'s `build` job also call, so the key `mutation-build-<os>-<hash>` is written once and hashed before install; `pnpm`, `node` (Node 24), `tarballs` and `install` (`pnpm install --frozen-lockfile`), in `mutation.yml`'s order. Every step carries an `id`, so the verdict can name the one that failed.
3. `restore`: `.turbo/cache` under that key, with the action's `prefix` output as the fallback.
4. `download`: `${{ env.MATRIX_ARTIFACT }}` into `$MATRIX_DIR` with `actions/download-artifact@v8` and `continue-on-error: true`. Its name says it is not a verdict; `matrix-check` judges its outcome.
5. `matrix-check` runs `node scripts/drop-audit-verdict.ts matrix-check`, which writes a `reason` output and exits 1: `MATRIX_MISSING` when `needs.kill-matrix.result` is not `success`; `MATRIX_NOT_DOWNLOADED` when the lane passed but the download failed or left no `$MATRIX_DIR` (an empty plan, whose skipped `collect` publishes nothing, or a failed download; `gh run download` tells them apart); `MATRIX_INCOMPLETE`, with an `absent` output, when a `PROJECTS` entry lacks `$MATRIX_DIR/<project>/stryker-incremental.json`.
6. `build`: `packages/stryker-js` and every `PROJECTS` entry with Turbo filters, as #288 does.
7. `audit`: `node packages/stryker-js/dist/main.mjs audit --matrix "$MATRIX_DIR" --projects "$PROJECTS" --out "$AUDIT_OUT" 2>&1 | tee audit.txt` between `set +e` and `set -e`, with `status=${PIPESTATUS[0]}`, because GitHub runs `shell: bash` as `bash --noprofile --norc -eo pipefail` and `-e` would end the step before it writes `status`; so the exit-2 refusal line lands in `audit.txt` whichever stream the CLI writes it to (the audit reads the matrix before it writes any report, so `$AUDIT_OUT` does not exist on that path); it writes `status` as an output and exits with it.
8. `audit-summary` (report only): `audit.txt` in a text block in the step summary.
9. `upload`: `$AUDIT_OUT` as `drop-audit-${{ github.run_number }}`, 14 days, on `!cancelled()` when the file exists.
10. `verdict` on `always()` runs `node scripts/drop-audit-verdict.ts verdict` over `toJSON(steps)`. It takes the first failed or cancelled step in job order, then any step missing from that order, so a step added later can never read as OK (`download` and `verdict` excluded), and maps it through a closed reason table, each code with the next action and a command that reproduces it from the workspace root (pack rule `ci-wall-clock/failures-name-the-gate-and-location.md`): `install` -> `DROP_AUDIT_INSTALL_FAILED`; `matrix-check` -> its own reason; `build` -> `DROP_AUDIT_BUILD_FAILED`; `audit` -> `DROP_AUDIT_FAILED` (exit 1), `DROP_AUDIT_REFUSED` (exit 2) or `DROP_AUDIT_UNCLASSIFIED` naming any other exit (an interrupt or a crash); `upload` -> `DROP_AUDIT_UPLOAD_FAILED`; a cancelled step -> `DROP_AUDIT_TIMED_OUT`; any other step -> `DROP_AUDIT_UNCLASSIFIED` naming its id; none -> `DROP_AUDIT_OK`. `MATRIX_MISSING` names the kill-matrix lane's failed job as the gate and the dispatch as its reproduce, since mutation runs only in CI. If the script cannot run, the step writes `DROP_AUDIT_UNCLASSIFIED` and fails.
11. `job-report` (`.github/actions/job-report`, as `ci.yml`'s jobs use it) on `always()` writes the summary heading, the duration and, on a failure, an annotation titled with the reason code whose message is the next action.

### Enrollment (R6)

Each of `packages/stryker-js-instrumenter` and `packages/stryker-js-html-reporter` gets:

- `stryker.config.ts`, byte-identical to `packages/stryker-js-vitest-runner/stryker.config.ts`: `sharedConfig`, the published vitest runner and TypeScript checker through `installedPlugin`, both ignorers through `import.meta.resolve`, `mutate` `src/**/*.workflow.ts` without tests, `.d.ts` and `__tests__`, and `dryRunTimeoutMinutes: 10`.
- devDependencies the config resolves: `@systemfsoftware/stryker-config: workspace:^`, and the published tarballs `file:../../.sfs-deps/<name>.tgz` of `stryker-js`, `stryker-js-vitest-runner`, `stryker-js-typescript-checker` and `stryker-ignorer-in-source-vitest-block`. The HTML reporter also gets `stryker-ignorer-effect-schema-declarations`'s tarball; the instrumenter keeps its `workspace:^` entry (KD4).
- a `"mutation": "stryker run"` script, as the three enrolled packages have.
- `stryker.config.ts` in `tsconfig.node.json`'s `include`, so `typecheck` covers the config.
- `pnpm-lock.yaml` regenerated with `pnpm install`.

`.changeset/<slug>.md` records `none` for both packages: the configs and devDependencies are outside every package's published `files`.

### Assumptions

- The budget gate (`.stryker/budget-baseline.json`, one `actualSeconds` of 561.078) is report-only (`mutation.yml:330-361`). Two more projects raise the run time, so `BUDGET_EXCEEDED` warnings are expected until a maintainer re-baselines from a five-project run.
- `github.run_number` in a called workflow is the caller's, and the called workflow's artifacts belong to the caller's run: `mutation.yml` push run 38335732420 holds `kill-matrix-457`, uploaded by `kill-matrix.yml`'s `collect` (#288's evidence). So `drop-audit` downloads `kill-matrix-${{ github.run_number }}` with no run id.
- `needs: [kill-matrix]` on a reusable-workflow job waits for every job of the called workflow. A failed shard fails the call and skips `collect`; a `collect` skipped because the plan was empty leaves no artifact while the call succeeds. The first fails step 5 with `MATRIX_MISSING`, the second with `MATRIX_NOT_DOWNLOADED`, whose message names both an empty plan and a failed download, because `drop-audit` has no `actions: read` to ask which.
- With no `concurrency` group, a dispatched recovery run starts beside a running nightly instead of queueing behind it. Their artifacts are named by run number and their cache saves under one key are first-writer-wins (a second save of an existing key is a warning, not a failure), so overlapping runs are safe.

## Implementation Units

**Test admission:** one new committed test, `scripts/drop-audit-verdict.test.ts`, for the pure decisions the job runs (`matrixReasonOf`, `firstFailedStep`, `verdictOf`, and `stepsOf`, the decode of GitHub's `toJSON(steps)`): which reason a set of step outcomes produces, that no red step reads as OK, and that each failure code carries a reproduce or re-run command. It runs in the repo-scripts step of `ci.yml`'s `check` job (`./bin/deno test -P --config=scripts/deno.json scripts/`), beside `turbo-summary.test.ts`, which tests `ci.yml`'s own verdict script the same way. It asserts the script's behaviour, not the workflow's text; no test pins `mutation.yml` itself, and a test of the audit belongs to `stryker audit`'s own suite.

### U1. Triggers, cost header and corpus

**Files:** `.github/workflows/mutation.yml`, `.github/workflows/kill-matrix.yml`, `.github/actions/mutation-build-key/action.yml` (new).

**Approach:** the hunks under "Workflow hunks" except the `drop-audit` job.

**Test scenarios:** both workflows parse as YAML. `on` has exactly `schedule` and `workflow_dispatch`; neither workflow has a `concurrency` key. No `head_commit`, `paths-ignore` or `github-actions[bot]` string remains in `mutation.yml`. `PROJECTS` and both `kill-matrix.yml` defaults name the same five projects.

### U2. `drop-audit`

**Files:** `.github/workflows/mutation.yml`, `scripts/drop-audit-verdict.ts` (new), `scripts/drop-audit-verdict.test.ts` (new).

**Approach:** the job above.

**Test scenarios:** `scripts/drop-audit-verdict.test.ts` (12 cases, using `scripts/assert.ts`): the matrix reasons (a failed lane is `MATRIX_MISSING` whatever the download did; a passed lane without a matrix is `MATRIX_NOT_DOWNLOADED`; a missing project is `MATRIX_INCOMPLETE`; a complete matrix passes); all-passed is `DROP_AUDIT_OK` and a failed `download` alone does not fail it; `start` or a step id the table does not list is `DROP_AUDIT_UNCLASSIFIED` naming it; the earliest failed step decides and a cancelled one is `DROP_AUDIT_TIMED_OUT`; the audit's exits 1, 2, 130 and none map to their codes; a failed audit's reproduce is the job's own download, build and audit command; each failed step maps to its own code (`install`, `build`, `upload`, each matrix reason, audit exits 1 and 2, a failed `checkout`, a cancelled step) and carries a command; a payload in GitHub's `toJSON(steps)` shape decodes to the verdict its failed step names; a `STEPS` value that is not a JSON object is refused. Reasons are the closed type `DropAuditReason`, so a misspelt code fails the typecheck. Each decision was mutated once (unlisted steps ignored, the download counted, exit 2 read as a failed drop, the download checked before the lane, a cancel read as a failure) and each mutation turned the suite red. Run through the steps' own `run:` blocks under `bash --noprofile --norc -eo pipefail` with Node 24: `matrix-check` writes each reason and exits 1, or exits 0 on a complete matrix; `verdict` writes `DROP_AUDIT_OK`, `DROP_AUDIT_REFUSED` and, for a failed `start`, `DROP_AUDIT_UNCLASSIFIED`, and on unparseable `STEPS` writes `DROP_AUDIT_UNCLASSIFIED` and fails; the `audit` block writes `status` for exits 0, 1 and 2, and `audit.txt` holds stdout and stderr.

### U3. Enroll the instrumenter and the HTML reporter

**Files:** both packages' `stryker.config.ts` (new), `package.json` and `tsconfig.node.json`; `pnpm-lock.yaml`; `.changeset/<slug>.md`.

**Test scenarios:** `pnpm install --frozen-lockfile` passes; `pnpm exec turbo run typecheck --filter=./packages/stryker-js-instrumenter --filter=./packages/stryker-js-html-reporter` passes; `lockfile-closure-digest.integration.test.ts` passes with five projects; the changeset passes `check_changeset.ts`.

## Verification

- `./bin/dprint check`, `pnpm lint:conventions`, `pnpm gate:repo` (one plan added).
- U1-U3 scenarios above.
- Full-path `ce-code-review`, report-only, on the PR head.
- After merge, from CI only: the first nightly or dispatched run publishes `kill-matrix-<n>` covering five projects, `drop-audit` passes against it, and its job-minutes go into the header's next revision.

## Risks

- **Instrumenter tests under the vitest runner plugin are unmeasured.** `testResources` fixtures may need a longer dry run. The first nightly run shows it. Its fix is a config change, not a skipped project.
- **Cost rises once.** Two more projects in a `--full` scoring lane and a `--full` kill matrix each night. The header states the measured three-project figure and says the share is pending.
- **Duplicate judgment surface** while #288's `ci.yml` job is open (KD2). The two can disagree on one commit: #288's job audits the newest completed matrix, this one its own run's.
- **The header is a three-project figure.** The first five-project nightly is expected above its band; the header is re-measured from those runs.
- **Test-set precedent is mixed.** The new configs follow the vitest runner's and checker's `vitest.config.ts`, which includes their integration suites; `packages/stryker-js` narrows mutation to `vitest.mutation.config.ts`. The instrumenter's `tests/**` suites may make its share heavier than its 9 workflow files suggest.
