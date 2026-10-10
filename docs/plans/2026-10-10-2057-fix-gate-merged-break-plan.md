---
title: "fix: stryker gate judges a merged report against each project's thresholds.break"
type: fix
status: active
date: 2026-10-10
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
---

# fix: stryker gate judges a merged report against each project's thresholds.break

## Goal Capsule

A sharded run passes today when its merged score is below `thresholds.break`. Each shard downgrades its own break failure to an info line (`packages/stryker-js/src/shard/shard-run.ts:70`). `stryker merge` does not judge the score, and `stryker gate` checks only `--baseline` and `--budget-baseline`. After this change, `stryker gate` gives the merged report the same verdict an unsharded run gives, project by project, and exits non-zero with the reason code `score-below-break`.

Packs: cell-architecture (pure decision in a `*.workflow.ts`, the cell only reads and wires), boundary-testing (refusal tests at the verdict's edges), schema-laws (the per-project field is a schema with a round-trip law). CONSTITUTION articles cited by ADR-0001: CONST-P2 and CONST-T4, because a decision outside a workflow is not mutated.

## Product Contract

### Problem (measured on main 56426ca94)

`packages/stryker-js/tests/shard-merge.integration.test.ts`, scenario "A merged report scoring below its break threshold fails the gate, as the unsharded run fails", is committed red on this branch. The fixture sets `thresholds.break: 100` and every mutant survives. The unsharded `stryker run` exits 1. Both shards exit 0, `merge` succeeds, and `stryker gate` exits 0 without printing `score-below-break`.

The merged report also loses per-project thresholds: `thresholdsOf` (`shard/shard-merge.ts:163-164`) copies the first project report's thresholds, and the gate's reader `PriorReportDocument` (`Survivors/Survivors.schema.ts`) does not decode `thresholds` at all.

### Requirements

- R1. `stryker gate` judges every project in the finished report against that project's own `thresholds.break`. The score is the total mutation score: `Report.metricsFromMutants(mutants).mutationScore`, which is the score the unsharded path passes to `classifyExit` (`mutation-reporting.service.ts:741`).
- R2. The verdict comes from `classifyExit`. A score below break fails. A score equal to break passes. A null break gives no verdict. An `Unscored` project gives no verdict (ruling B). When an `Unscored` project has a break set, the gate logs the same info line the unsharded path logs (`mutation-reporting.service.ts:780-790`).
- R3. A failure uses the existing reason code `score-below-break` (`Mutant.RunFailureCode`); no new code is added. The output starts with a counts-first summary line. Each failing project then gets one line with its label, score and break. A last line gives the next action: kill the survivors the report lists, or lower `thresholds.break` (null disables the verdict). The exit class is `VerdictFail` (exit 1).
- R4. `stryker merge` writes each project's thresholds and its file keys into the merged report, so the gate needs no config read (ruling A). A report without that field, such as an unsharded run's report, is judged as a single project with the report's top-level thresholds over every file.
- R5. The `--baseline` and `--budget-baseline` verdicts are unchanged and their existing scenarios still pass. A score above break with new baseline survivors still fails on the baseline verdict. The gate runs the baseline check, then the budget check, then the break check, and the first failure decides the exit.
- R6. Changeset: `@systemfsoftware/stryker-js` major, because a gate that passed today now fails. Migration: set `thresholds.break: null`, or raise the score. The README rows for `stryker gate` and exit code 1 say the gate judges the break.

### Acceptance (tests)

- A1 (journey, already committed red): the merged report below break → shards exit 0, gate exits 1, output names `score-below-break` and the threshold.
- A2 (journey, ruling A refusal): two projects, `first` with break 0 and `second` with break 50, all mutants surviving. The gate exits 1 and names `second` only. Applying the first project's break to every project would pass this run.
- A3 (workflow properties, `gate-score-break.workflow.property.test.ts`): a project fails iff it is `Scored` with a non-null break and percentage < break. Equality passes. Null break and `Unscored` give no verdict. The error lists exactly the failing projects, in input order.
- A4 (schema law): the merged-project field round-trips.
- Existing gate and budget scenarios in `tests/gate.integration.test.ts` and `tests/shard-merge.integration.test.ts` stay green unchanged.

Test layers (test-layer-selection admission gate): A3 is a decision, so it gets property tests only. A4 is a schema, so it gets a codec law. A1 and A2 spawn the built CLI, which the gate refuses as integration tests. They are admitted only as journeys under its "top-level failure contract" seam: the merge→gate handoff crosses two commands and a file. That makes two journeys, inside the 2-4 cap. Everything else is pushed down to A3/A4. No other test is admitted.

### Edge review (destructive pass, Edge-First lens)

- A report with no `projects` field is judged as one project. A multi-project report merged by an older CLI would get the first project's thresholds. This is residual: `merge` and `gate` run from the same published CLI in one CI job (`.github/workflows/mutation.yml:330-340`).
- When the baseline check fails first, the break failure is not reported. Both remediations ask for the survivors to be killed, and R5 keeps the existing verdicts unchanged.
- Projects are partitioned by explicit per-project `files` lists, not by path-prefix inference. Nested project directories would make prefixes ambiguous.

### Scope boundaries

- `stryker run` and the shard driver keep their exit behaviour.
- When two shards disagree on a project's thresholds, the first shard's thresholds win. All shards of a project load the same config.
- The dogfood config (`packages/toolchain/stryker-config/lib/base.js:25`, `break: 100`) is not touched. See Open questions.

## Implementation (small)

- U1. `packages/stryker-js/src/gate-score-break.workflow.ts`: `GateScoreBreakCommand { projects: [{ project, statuses, breakingThreshold }] }` → `ScoreAtOrAboveBreak`, or the error `ScoreBelowBreak { breaches: [{ project, percentage, threshold }] }` with `code: 'score-below-break'` and `exitClass: 'VerdictFail'`. It scores each project with `metricsFromMutants` and decides through `classifyExit`. Properties A3.
- U2. `packages/stryker-js/src/shard/shard-merge.schema.ts`: `MergedProject { project, thresholds, files }`. `shard-merge.ts` writes `projects` beside `thresholds`. Law A4.
- U3. `run-request.cell.ts` `gateReport`: decode `thresholds` and the optional `projects` (gate-only reader schema), group the files into projects, and run the U1 workflow after the budget check. Add `ScoreBelowBreak` to `CliFailure`, with no `GATE_REMEDIATION_LINE` for it. Update the shard-run downgrade line to name `stryker gate`.
- U4. Journey A2 in `shard-merge.integration.test.ts`. README rows. Changeset.

## Open questions for the supervisor

- Q1. Main's Mutation run will fail at its gate step once a release carrying this change becomes the `stryker-published` input: the dogfood break is 100, and main scored 55.01 on run 37960922409. Set the shared config's break to null, set it to a floor below the current score, or accept the red?
