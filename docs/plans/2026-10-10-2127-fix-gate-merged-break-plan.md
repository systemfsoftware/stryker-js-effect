---
title: "fix: stryker gate judges a merged report against each project's thresholds.break"
type: fix
status: active
date: 2026-10-10
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
supersedes: docs/plans/2026-10-10-2115-fix-gate-merged-break-plan.md
---

# fix: stryker gate judges a merged report against each project's thresholds.break

## Goal Capsule

A sharded run passes today when its merged score is below `thresholds.break`. Each shard downgrades its own break failure to an info line (`packages/stryker-js/src/shard/shard-run.ts:70`). `stryker merge` does not judge the score, and `stryker gate` checks only `--baseline` and `--budget-baseline`. After this change, `stryker gate` gives the merged report the same verdict an unsharded run gives, project by project, and exits non-zero with the reason code `score-below-break`.

Packs: cell-architecture (pure decision in a `*.workflow.ts`; the cell only reads, groups straight-line and wires), boundary-testing (refusal tests at the verdict's edges), schema-laws (the per-project field and the gate's reader are schemas with generated round-trip laws). CONSTITUTION articles cited by ADR-0001: CONST-P2 and CONST-T4, because a decision outside a workflow is not mutated.

Supersedes the 2115 plan after the review rulings (it_bdfe56a0, on `e581c9fa0`). Changed contract: update flags keep the break check (R5); a project with no recorded thresholds gets an info line, not a silent pass (R7); the repository's own break becomes a ratchet floor (R8); two gate journeys are added (A5, A6); A3 also pins the info lines.

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
- R6. Changeset: `@systemfsoftware/stryker-js` major, because a gate that passed today now fails. Migration: raise the score, or set `thresholds.break: null`. The README rows for `stryker gate` and exit code 1 say the gate judges the break, in one statement.
- R7. A merged project whose shard streams carry no `verdict` line has no recorded thresholds (`thresholds: null`). It gets no verdict and the stable info line `stryker gate: <project>: no thresholds recorded for this project; re-run its shards with the project's config`. No reason code is added for it.
- R8. The repository's own mutation config (`packages/toolchain/stryker-config/lib/base.js`, shared by every dogfood project) sets `thresholds.break` to a ratchet floor: the weakest project's score on main, rounded down. Main run 38083502908 (`56426ca94`) measured stryker-js 46.45, typescript-checker 54.27, vitest-runner 69.35 and e2e-core 72.20, total 58.27 (run 37960922409 totalled 55.01). Because each project is judged against the shared break, the floor is 46: 55 would fail stryker-js. `.github/workflows` is not touched.

### Acceptance (tests)

- A1 (journey, `shard-merge.integration.test.ts`): the merged report below break → shards exit 0, gate exits 1, output names `score-below-break` and the threshold.
- A2 (journey, ruling A refusal, `shard-run-verdict.integration.test.ts`): two projects, `first` with break 0 and `second` with break 50, all mutants surviving. The gate exits 1, names `second` only, and counts `1 of 2` projects.
- A3 (workflow properties, `gate-score-break.workflow.property.test.ts`, drawing `ProjectScore`): a project fails iff it is `Scored` with a non-null break and percentage < break, with the breach naming its score and break; otherwise it passes, and its info lines are exactly the "no valid mutant" line iff `Unscored` with a break and the "no thresholds recorded" line iff its thresholds are null. Two projects: the error lists exactly the failing ones, in input order.
- A4 (schema laws, generated by `inSourceSchemaLaws`): `MergedProject` and `GateReportDocument` round-trip.
- A5 (journey, `gate.integration.test.ts`, the `.` project path): an unsharded report scoring 0 under break 50 with `--update-baseline` writes the baseline and exits 1 naming `.` and the break.
- A6 (journey, `gate.integration.test.ts`): a report below break with a new survivor fails on the baseline verdict and emits no `score-below-break`.
- Existing gate and budget scenarios stay green unchanged.

Test layers: A3 is a decision, so it gets property tests only. A4 is a schema, so it gets codec laws. A1, A2, A5 and A6 spawn the built CLI under the "top-level failure contract" seam: the merge→gate handoff and the ordering of the gate's three verdicts are only observable through the command. That is four journeys, at the 2-4 cap. Everything else is pushed down to A3/A4.

### Edge review (destructive pass, Edge-First lens)

- A merged report puts every file in a project, so `.` is empty and skipped. A multi-project report merged by an older CLI has no `projects` and a top-level break of null, so it gets no verdict. This is residual: `merge` and `gate` run from the same published CLI in one CI job (`.github/workflows/mutation.yml:330-340`).
- A report with no files has no score, so it gets no verdict and no "no valid mutant" line.
- When the baseline check fails first, the break failure is not reported (A6). Both remediations ask for the survivors to be killed.
- Projects are partitioned by explicit per-project `files` lists, not by path-prefix inference.
- A floor of 46 lets the stronger projects regress to 46 before the gate fails. Per-project floors would need per-project configs; the shared config is one number. Residual, and the ratchet raises it.

### Scope boundaries

- `stryker run` and the shard driver keep their exit behaviour.
- When two shards disagree on a project's thresholds, the first shard's thresholds win. All shards of a project load the same config.

## Implementation

- U1 (landed `d360a08a1`, revised). `gate-score-break.workflow.ts`: `ProjectScore { project, score, thresholds: { break } | null }`. `ScoreAtOrAboveBreak { unscored, unrecorded }` exposes `lines`; `ScoreBelowBreak { breaches, projects, unscored, unrecorded }` prints the same lines inside its message. Each project goes through `classifyExit`.
- U2 (landed `e581c9fa0`, revised). `MergedProject { project, thresholds: VerdictThresholds | null, files }`; `shard-merge.ts` writes null when no shard stream of the project has a `verdict` line.
- U3 (landed `e581c9fa0`, revised). `gate-report.schema.ts` and `run-request.cell.ts`: the cell passes thresholds through and logs the decision's `lines`.
- U4 (landed `e581c9fa0`). A2, READMEs, changeset.
- U5. A5 and A6 in `gate.integration.test.ts`; README row rewritten; ratchet floor R8.
