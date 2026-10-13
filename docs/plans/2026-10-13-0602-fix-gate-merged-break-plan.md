---
title: "fix: stryker gate judges a merged report against each project's thresholds.break"
type: fix
status: active
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
supersedes: docs/plans/2026-10-13-0325-fix-gate-merged-break-plan.md
---

# fix: stryker gate judges a merged report against each project's thresholds.break

This revision corrects only the unrecorded-thresholds shape: the shipped contract is a tagged union (`Recorded | Unrecorded`), never `null` (full-path review run 20261013-051057-2f111cb4, findings 4 and 5).

## Goal Capsule

A sharded run passes today when its merged score is below `thresholds.break`. Each shard downgrades its own break failure to an info line (`packages/stryker-js/src/shard/shard-run.ts:70`). `stryker merge` does not judge the score, and `stryker gate` checks only `--baseline` and `--budget-baseline`. After this change, `stryker gate` gives the merged report the same verdict an unsharded run gives, project by project, and exits non-zero with the reason code `score-below-break`.

Packs: cell-architecture (pure decision in a `*.workflow.ts`; the cell only reads, groups straight-line and wires), boundary-testing (refusal tests at the verdict's edges), schema-laws (the per-project field and the gate's reader are schemas with generated round-trip laws). CONSTITUTION articles cited by ADR-0001: CONST-P2 and CONST-T4, because a decision outside a workflow is not mutated.

Supersedes the 2220 plan, whose R8 lowered the dogfood break (shared 100 to 46, plus per-project floors 46/54/69/72) without a CONST-W3 declaration. Implementation had started, so this is a new contract, not an in-place edit. Changed contract: R8 now changes no threshold value (CONST-E9, CONST-T3, CONST-G3), and U5/U6 drop the floor edits. R1-R7, A1-A6 and U1-U4 carry over unchanged.

## Product Contract

### Problem (measured on main 56426ca94)

`packages/stryker-js/tests/shard-merge.integration.test.ts`, scenario "A merged report scoring below its break threshold fails the gate, as the unsharded run fails", was committed red on this branch. The fixture sets `thresholds.break: 100` and every mutant survives. The unsharded `stryker run` exits 1. Both shards exit 0, `merge` succeeds, and `stryker gate` exits 0 without printing `score-below-break`.

The merged report never carries the configured break. Merge rebuilds each project's report from its shard stream through `reportFromStream`, which writes the constant `STREAM_THRESHOLDS = { high: 100, low: 80, break: null }` (`report-from-stream.workflow.ts:10,80`). `thresholdsOf` (`shard/shard-merge.ts:163-164`) then copies that constant from the first project. The configured thresholds survive only on each stream's terminal `verdict` line (`RunEvent.VerdictReached.thresholds`, `run-event.schema.ts:284`). The gate's reader `PriorReportDocument` (`Survivors/Survivors.schema.ts`) does not decode `thresholds` at all.

### Requirements

- R1. `stryker gate` judges every project in the finished report against that project's own `thresholds.break`. The score is the total mutation score: `Report.metricsFromMutants(mutants).mutationScore`, which is the score the unsharded path passes to `classifyExit` (`mutation-reporting.service.ts:741`).
- R2. The verdict comes from `classifyExit`. A score below break fails. A score equal to break passes. A null break gives no verdict. An `Unscored` project gives no verdict (ruling B). When an `Unscored` project has a break set, the gate logs an info line naming the project.
- R3. A failure uses the existing reason code `score-below-break` (`Mutant.RunFailureCode`); no new code is added. The output starts with a counts-first summary line. Each failing project then gets one line with its label, score and break. A last line gives the next action: kill the survivors the report lists, or lower `thresholds.break` (null disables the verdict). The exit class is `VerdictFail` (exit 1).
- R4. `stryker merge` writes each project's thresholds and its file keys into the merged report as `projects`, so the gate needs no config read (ruling A). Files outside every listed project, which is every file of an unsharded run's report, are judged as one project `.` with the report's top-level thresholds.
- R5. The `--baseline` and `--budget-baseline` verdicts are unchanged. The gate runs the baseline check, then the budget check, then the break check, and the first failure decides the exit. Under `--update-baseline` or `--update-budget-baseline` the baselines are written first and the break check still runs: updating a baseline does not accept a low score.
- R6. Changeset: `@systemfsoftware/stryker-js` major, because a gate that passed today now fails. Migration: raise the score, set each project's own `thresholds.break` to its current score, or set it to `null`. The README rows for `stryker gate` and exit code 1 say the gate judges each project against the break in its own config, in one statement.
- R7. A merged project whose shard streams carry no `verdict` line has unrecorded thresholds (the `Unrecorded` variant of `MergedProjectThresholds`). It gets no verdict and the stable info line `stryker gate: <project>: no thresholds recorded for this project; re-run its shards with the project's config`. No reason code is added for it.
- R8. This change edits no threshold. `packages/toolchain/stryker-config/lib/base.js` keeps `thresholds.break: 100`, and no dogfood `stryker.config.ts` overrides it. Thresholds are a judgment surface, so the change they grade may not edit them (CONST-E9). CONST-T3's check is break = 100. Lowering it without a declaration in the change itself is an automatic P0 (CONST-G3, CONST-W3). Consequence: main's Mutation lane (nightly or manual dispatch) runs the released CLI pinned by the `stryker-published` flake input, not the branch build (`.github/workflows/mutation.yml:37` `PUBLISHED_CLI`, `packages/stryker-js/package.json:71` `file:../../.sfs-deps/stryker-js.tgz`; AGENTS.md Dogfood row). Merging this change therefore leaves the lane's break check unenforced. The gate step starts failing while a project scores below 100 only after a release that contains this change ships and the pin moves to it, which is a human-approved release step (AGENTS.md Human approval row). This change also edits `stryker gate`, the program that grades the repo's own runs. That edit only tightens the gate, keeps break at 100, and cannot grade this change before that release, so no rule is bypassed and no CONST-W3 declaration is needed. Main scored 58.27 on run 37960922409, and the per-project scores on run 38083502908 were stryker-js 46.45, typescript-checker 54.27, vitest-runner 69.35 and e2e-core 72.20. Any lower floor is the instrument owner's separate change, carrying its own CONST-W3 declaration that names the rule and the case. Those measured scores are evidence for that owner, not values this change sets. `.github/workflows` is not touched.

### Acceptance (tests)

- A1 (journey, `shard-merge.integration.test.ts`): the merged report below break → shards exit 0, gate exits 1, output names `score-below-break` and the threshold.
- A2 (journey, ruling A refusal, `shard-run-verdict.integration.test.ts`): two projects, `first` with break 0 and `second` with break 50, all mutants surviving. The gate exits 1, names `second` only, and counts `1 of 2` projects.
- A3 (workflow properties, `gate-score-break.workflow.property.test.ts`, drawing `ProjectScore`): a project fails iff it is `Scored` with a non-null break and percentage < break, with the breach naming its score and break; otherwise it passes, and its info lines are exactly the "no valid mutant" line iff `Unscored` with a break and the "no thresholds recorded" line iff its thresholds are `Unrecorded`. Two projects: the error lists exactly the failing ones, in input order.
- A4 (schema laws, generated by `inSourceSchemaLaws`): `MergedProject` and `GateReportDocument` round-trip.
- A5 (journey, `gate.integration.test.ts`, the `.` project path): an unsharded report scoring 0 under break 50 with `--update-baseline` writes the baseline and exits 1 naming `.` and the break.
- A6 (journey, `gate.integration.test.ts`): a report below break with a new survivor fails on the baseline verdict and emits no `score-below-break`.
- Existing gate and budget scenarios stay green unchanged.

Test layers: A3 is a decision, so it gets property tests only. A4 is a schema, so it gets codec laws. A1, A2, A5 and A6 spawn the built CLI under the "top-level failure contract" seam: the merge→gate handoff and the ordering of the gate's three verdicts are only observable through the command. That is four journeys, at the 2-4 cap. Everything else is pushed down to A3/A4.

### Edge review (destructive pass, Edge-First lens)

- A merged report puts every file in a project, so `.` is empty and skipped. A multi-project report merged by an older CLI has no `projects` and a top-level break of null, so it gets no verdict. This is residual: `merge` and `gate` run from the same published CLI in one CI job (`.github/workflows/mutation.yml:300-303` merge, `:334-348` gate).
- A report with no files has no score, so it gets no verdict and no "no valid mutant" line.
- When the baseline check fails first, the break failure is not reported (A6). Both remediations ask for the survivors to be killed.
- Projects are partitioned by explicit per-project `files` lists, not by path-prefix inference.
- A red gate step skips the budget-baseline bootstrap upload (`.github/workflows/mutation.yml:361-365`). Once a release carrying this change is pinned, the comment at `.github/workflows/mutation.yml:331-333` ("BudgetExceeded is the only exit 1") is no longer true, because `score-below-break` is a second exit-1 path. The step's budget-regex check then fails the job, which is the intended outcome. Both points belong to Stream K, which owns the workflow; this change does not touch it.
- A diff-scoped report is judged like any other: the gate reads the report's `files` and `projects`, never its run `scope` (R1, R4). The score is over the mutants the report holds, compared with the break that project's config resolved.

### Scope boundaries

- `stryker run` and the shard driver keep their exit behaviour.
- When two shards disagree on a project's thresholds, the first shard's thresholds win. All shards of a project load the same config.

## Implementation

- U1 (landed `d360a08a1`, revised). `gate-score-break.workflow.ts`: `ProjectScore { project, score, thresholds: ProjectThresholds }`, where `ProjectThresholds = Recorded { break } | Unrecorded`. `ScoreAtOrAboveBreak { unscored, unrecorded }` exposes `lines`; `ScoreBelowBreak { breaches, projects, unscored, unrecorded }` prints the same lines inside its message. Each project goes through `classifyExit`.
- U2 (landed `e581c9fa0`, revised). `MergedProject { project, thresholds: MergedProjectThresholds, files }`, where `MergedProjectThresholds = Recorded VerdictThresholds | Unrecorded`; `shard-merge.ts` writes the `Unrecorded` variant when no shard stream of the project has a `verdict` line.
- U3 (landed `e581c9fa0`, revised). `gate-report.schema.ts` and `run-request.cell.ts`: the cell passes thresholds through and logs the decision's `lines`.
- U4 (landed `e581c9fa0`). A2, READMEs, changeset.
- U5 (landed `7ec745776`). A5 and A6 in `gate.integration.test.ts`; README row rewritten.
- U6 (landed `af63359f9`). No threshold edit (R8): `base.js` and the four dogfood `stryker.config.ts` files equal `main`, and no floors changeset ships. The changeset migration and the README row name the project's own config.
