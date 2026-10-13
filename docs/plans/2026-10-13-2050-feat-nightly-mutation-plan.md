---
title: Nightly-Only Mutation With A Same-Run Drop Audit - Plan
type: ci
date: 2026-10-13
topic: nightly-mutation
artifact_contract: ce-unified-plan/v1
product_contract_source: root-order
execution: code
---

# Nightly-Only Mutation With A Same-Run Drop Audit - Plan

## Goal Capsule

- **Objective:** Mutation runs once a night and on dispatch, never on a push or a pull request. Each such run that builds a kill matrix also audits it in the same run, and the corpus is every shipped package that holds a `*.workflow.ts`.
- **Means:** `.github/workflows/mutation.yml` keeps `schedule` and `workflow_dispatch` and drops `push`, with every clause that only a push could satisfy. The `kill-matrix` job runs on the schedule and on every dispatch. A new `drop-audit` job needs `kill-matrix` and audits that run's `kill-matrix-${{ github.run_number }}`. `packages/stryker-js-instrumenter` and `packages/stryker-js-html-reporter` join the corpus. A `# Cost:` header at line 1 states the lane's measured runner-minutes per day.
- **Product authority:** the root's order of 2026-10-13: nightly schedule plus `workflow_dispatch` only; the #288 drop audit with `needs: [kill-matrix]` on the same run's `kill-matrix-${{ github.run_number }}`; "enroll every package containing *.workflow.ts including stryker-js-instrumenter and stryker-js-plugin-interface; list packages with no workflow files" (verbatim; KD3 records why plugin-interface, which holds none, is listed rather than enrolled, and the PR body reports that correction to the root); a measured cost header in the shape of `bench.yml:1`, for the reason the #333 review gave; no local mutation; one independent PR off current `main`.
- **House law:** Ryan's nightly-only mutation law of 2026-10-12: mutation runs only nightly or on manual dispatch on `main` CI, never on a push or a pull request, and never on a local machine.
- **Edit scope:** `.github/workflows/mutation.yml`, `.github/workflows/kill-matrix.yml` (the two `projects` defaults only), the two enrolled packages' `stryker.config.ts`, `package.json` and `tsconfig.node.json`, `pnpm-lock.yaml`, one changeset and this plan. No change to the kill-matrix lane's jobs, the verdict store, `ci.yml`, `test/e2e-core` or the three existing configs.
- **Workflow ownership (CONST-E9 here, CONST-E7 in the org's constitution):** `AGENTS.md` makes `.github/workflows/` read-only to agents. The root, who owns it, ordered this workflow change, so this unit edits `mutation.yml` and `kill-matrix.yml` on the branch. Every workflow hunk is listed under Planning Contract, "Workflow hunks".
- **Verification without mutation:** nothing here starts Stryker. Branch evidence is parsed workflow YAML, typechecked configs, a frozen install, `lockfile-closure-digest.integration.test.ts` (it reads `mutation.yml`'s `PROJECTS`), the repo gates and a full-path `ce-code-review`. The first nightly or dispatched run on `main` is the first run of the new jobs.

## Product Contract

### Problem Frame

- `mutation.yml:3-24` starts the lane on every non-docs push to `main`, on dispatch and at `17 3 * * *`. The house law allows only the last two.
- The kill-matrix lane runs only on a non-bot push or a `lane=kill-matrix` dispatch (`mutation.yml:381`). The last three scheduled runs, 38239240750, 38130563737 and 38042987222, published no `kill-matrix-<n>`. #288's recorded answer (closure item C1, https://github.com/systemfsoftware/stryker-js-effect/pull/288#issuecomment-6140435041) requires the schedule arm in the same change that removes `push`; without it no matrix is ever published again.
- #288 audits the newest matrix of a completed earlier `main` run. A push's own Mutation run is still running when that audit runs, so the audit judges the previous matrix (#288's T3). A job in the run that builds the matrix judges that matrix.
- The corpus is three packages (`mutation.yml:36`). Two more shipped packages hold `*.workflow.ts` and are not graded.
- `mutation.yml:1` is `name: Mutation`. No line states what the lane costs. The #333 review (run `20261013-170535-66c6722d`, finding #6, "Mutation heavy lane's cost changed with no runner-minutes header", pack rule `ci-wall-clock/heavy-lanes-state-their-daily-minutes`) found it; the validator rejected the finding only because `mutation.yml` was outside #333's diff. This PR edits `mutation.yml`, so it carries the header.

### Requirements

- R1. `mutation.yml`'s triggers are `schedule` (`17 3 * * *`, unchanged) and `workflow_dispatch` (inputs `full` and `lane`, unchanged). There is no `push` and no `pull_request`.
- R2. Every expression only a push could satisfy is gone: `paths-ignore`, the release-bot `concurrency.group` switch, and the `head_commit.author.username` clauses in the `plan`, `build` and `kill-matrix` conditions.
- R3. The kill-matrix lane runs on every scheduled run and every dispatch. `lane: all` runs the scoring lane, the kill-matrix lane and the drop audit. `lane: kill-matrix` runs the kill-matrix lane and the drop audit.
- R4. A `drop-audit` job with `needs: [kill-matrix]` audits the artifact `kill-matrix-${{ github.run_number }}` that run's `collect` job uploaded. It fails closed, with a reason code, an annotation, a step-summary line and the next action, when the artifact is absent, when it lacks a project of the corpus, and when `stryker audit` exits non-zero. It uploads `audit.json` as `drop-audit-${{ github.run_number }}`.
- R5. `mutation.yml` line 1 begins a `# Cost:` header in the shape of `bench.yml:1-16`: runner-minutes per day, the run shape that prices, per-run job-minutes with the run ids behind them, the 7-day first-parent merge count with its window, the rejected push counterfactual labelled as such, and the #333 finding as the reason the header exists.
- R6. The corpus is every shipped workspace package holding a `*.workflow.ts` outside `__tests__`: `packages/stryker-js`, `packages/stryker-js-typescript-checker`, `packages/stryker-js-vitest-runner`, `packages/stryker-js-instrumenter` and `packages/stryker-js-html-reporter`. `mutation.yml`'s `PROJECTS` and `INCREMENTAL_REPORTS` and both `projects` defaults in `kill-matrix.yml` list all five.
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
- KD5. **The corpus list is written in three places, and the audit catches a divergence.** A reusable-workflow call's `with:` cannot read `env`, so `kill-matrix.yml` keeps its own `projects` defaults (`kill-matrix.yml:9,15`) beside `mutation.yml`'s `PROJECTS`. The drop audit checks the downloaded matrix against `mutation.yml`'s `PROJECTS` and fails with `MATRIX_INCOMPLETE` on a missing project, so a divergence turns the run red instead of narrowing the audit. Rejected: a literal `with: projects:` in `mutation.yml`, which is still a second copy.
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

- `mutation.yml` lines 1-16: the `# Cost:` header (R5).
- `mutation.yml` `on:`: `push` with its `paths-ignore` deleted; `workflow_dispatch` and `schedule` unchanged.
- `mutation.yml` `concurrency:`: `group: mutation-${{ github.ref }}`; `cancel-in-progress` unchanged.
- `mutation.yml` `env:`: `PROJECTS` and `INCREMENTAL_REPORTS` list five projects, `PROJECTS` still one line under top-level `env:` (the shape #288's corpus reader and `lockfile-closure-digest.integration.test.ts:112-116` parse).
- `mutation.yml` `plan` and `build` `if:`: `github.event.inputs.lane != 'kill-matrix'` alone.
- `mutation.yml` `kill-matrix` job: its `if:` is deleted, so it runs on every schedule and dispatch.
- `mutation.yml` new `drop-audit` job (below).
- `kill-matrix.yml:9,15`: both `projects` defaults list the five projects.

### `drop-audit` job

`needs: [kill-matrix]` with `if: ${{ !cancelled() }}`, so a failed kill-matrix lane still reaches steps 4-5 and reports `MATRIX_MISSING` instead of a skipped job; `runs-on: ubuntu-latest`, `timeout-minutes: 60`, `permissions: contents: read`. Env: `MATRIX_DIR: kill-matrix`, `MATRIX_ARTIFACT: kill-matrix-${{ github.run_number }}`, `AUDIT_OUT: reports/audit.json`.

1. Record the start time.
2. Checkout; the build key `mutation-build-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml', 'turbo.json', 'packages/**') }}` hashed before install, the expression the `build` job uses; pnpm, Node 24, released tarballs and `pnpm install --frozen-lockfile`, in `mutation.yml`'s order.
3. Restore `.turbo/cache` under that key, with the `mutation-build-${{ runner.os }}-` prefix fallback.
4. Download `${{ env.MATRIX_ARTIFACT }}` into `$MATRIX_DIR` with `actions/download-artifact@v8` and `continue-on-error: true`.
5. Check the matrix (bash, `pipefail`). If the download failed, it fails with reason `MATRIX_MISSING`. If any `PROJECTS` entry lacks `$MATRIX_DIR/<project>/stryker-incremental.json`, it fails with `MATRIX_INCOMPLETE` naming the projects. Each failure writes an `::error` annotation with the code and a summary line with the next action: read this run's failed kill-matrix job, fix its cause, then re-run the lane (`gh workflow run mutation.yml --ref main -f lane=kill-matrix`), and on `MATRIX_INCOMPLETE` first make `kill-matrix.yml`'s `projects` defaults equal `mutation.yml`'s `PROJECTS`.
6. Build `packages/stryker-js` and every `PROJECTS` entry with Turbo filters, as #288 does.
7. `set +e; node packages/stryker-js/dist/main.mjs audit --matrix "$MATRIX_DIR" --projects "$PROJECTS" --out "$AUDIT_OUT" | tee audit.txt; status=${PIPESTATUS[0]}; set -e` under `shell: bash`, so the code and summary line are written before the step exits. A non-zero exit fails with reason `DROP_AUDIT_FAILED`, the exit code, and the next action: read the audit's lines in the summary and `drop-audit-<n>`; a `Fail` names a dropped mutant whose dominator has a killer it lacks.
8. Copy `audit.txt` under `## Drop audit` to the step summary with the artifact name and run link.
9. Upload `$AUDIT_OUT` as `drop-audit-${{ github.run_number }}`, 14 days, on `!cancelled()` when the file exists.
10. Append the job's wall time to the summary on `always()`.

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
- `needs: [kill-matrix]` on a reusable-workflow job waits for every job of the called workflow. A failed shard fails the call and skips `collect`; a `collect` skipped because the plan was empty leaves no artifact while the call succeeds. Either way step 5 fails with `MATRIX_MISSING`.
- The nightly and a dispatch on `main` share `mutation-refs/heads/main` without cancelling, so a dispatched recovery run queues behind a running nightly (wall up to 61 min), and a later pending run displaces an earlier pending one.

## Implementation Units

**Test admission:** no new committed test. The scenarios below use existing suites and throwaway scripts under `/tmp`. A test asserting the workflow's text would pin configuration, not behaviour, and a test of the audit itself belongs to `stryker audit`'s own suite, which this unit does not change.

### U1. Triggers, cost header and corpus

**Files:** `.github/workflows/mutation.yml`, `.github/workflows/kill-matrix.yml`.

**Approach:** the hunks under "Workflow hunks" except the `drop-audit` job.

**Test scenarios:** both workflows parse as YAML. `on` has exactly `schedule` and `workflow_dispatch`. No `head_commit`, `paths-ignore` or `github-actions[bot]` string remains in `mutation.yml`. `PROJECTS`, `INCREMENTAL_REPORTS` and both `kill-matrix.yml` defaults name the same five projects.

### U2. `drop-audit`

**Files:** `.github/workflows/mutation.yml`.

**Approach:** the job above.

**Test scenarios:** the matrix-check step's script, extracted and run in a scratch directory under `/tmp` with a five-project `PROJECTS`: no `$MATRIX_DIR` exits 1 with `MATRIX_MISSING`; a matrix missing one project exits 1 with `MATRIX_INCOMPLETE` naming it; a complete one exits 0.

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
