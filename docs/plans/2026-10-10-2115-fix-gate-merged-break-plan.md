---
title: "fix: stryker gate judges a merged report against each project's thresholds.break"
type: fix
status: active
date: 2026-10-10
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
supersedes: docs/plans/2026-10-10-2057-fix-gate-merged-break-plan.md
---

# fix: stryker gate judges a merged report against each project's thresholds.break

## Goal Capsule

A sharded run passes today when its merged score is below `thresholds.break`. Each shard downgrades its own break failure to an info line (`packages/stryker-js/src/shard/shard-run.ts:70`). `stryker merge` does not judge the score, and `stryker gate` checks only `--baseline` and `--budget-baseline`. After this change, `stryker gate` gives the merged report the same verdict an unsharded run gives, project by project, and exits non-zero with the reason code `score-below-break`.

Packs: cell-architecture (pure decision in a `*.workflow.ts`; the cell only reads, groups straight-line and wires), boundary-testing (refusal tests at the verdict's edges), schema-laws (the per-project field and the gate's reader are schemas with generated round-trip laws). CONSTITUTION articles cited by ADR-0001: CONST-P2 and CONST-T4, because a decision outside a workflow is not mutated.

Supersedes the 2057 plan after U1 landed (`d360a08a1`). Changed contract: A2 lives in `shard-run-verdict.integration.test.ts`; the gate's reader schema lives in `gate-report.schema.ts` with decode defaults; a report without `projects` is judged as the project `.`, and an older multi-project merged report gets no verdict rather than the first project's thresholds; the error's count field is `projects`.

## Product Contract

### Problem (measured on main 56426ca94)

`packages/stryker-js/tests/shard-merge.integration.test.ts`, scenario "A merged report scoring below its break threshold fails the gate, as the unsharded run fails", was committed red on this branch (`fix/gate-merged-break`). The fixture sets `thresholds.break: 100` and every mutant survives. The unsharded `stryker run` exits 1. Both shards exit 0, `merge` succeeds, and `stryker gate` exits 0 without printing `score-below-break`.

The merged report never carries the configured break. Merge rebuilds each project's report from its shard stream through `reportFromStream`, which writes the constant `STREAM_THRESHOLDS = { high: 100, low: 80, break: null }` (`report-from-stream.workflow.ts:10,80`). `thresholdsOf` (`shard/shard-merge.ts:163-164`) then copies that constant from the first project. The configured thresholds survive only on each stream's terminal `verdict` line (`RunEvent.VerdictReached.thresholds`, `run-event.schema.ts:284`). The gate's reader `PriorReportDocument` (`Survivors/Survivors.schema.ts`) does not decode `thresholds` at all. The supervisor's pre-read, that the merged report copies the first shard's thresholds, is wrong on this point: what it copies is the stream constant.

### Requirements

- R1. `stryker gate` judges every project in the finished report against that project's own `thresholds.break`. The score is the total mutation score: `Report.metricsFromMutants(mutants).mutationScore`, which is the score the unsharded path passes to `classifyExit` (`mutation-reporting.service.ts:741`).
- R2. The verdict comes from `classifyExit`. A score below break fails. A score equal to break passes. A null break gives no verdict. An `Unscored` project gives no verdict (ruling B). When an `Unscored` project has a break set, the gate logs an info line naming the project, as the unsharded path does (`mutation-reporting.service.ts:780-790`).
- R3. A failure uses the existing reason code `score-below-break` (`Mutant.RunFailureCode`); no new code is added. The output starts with a counts-first summary line. Each failing project then gets one line with its label, score and break. A last line gives the next action: kill the survivors the report lists, or lower `thresholds.break` (null disables the verdict). The exit class is `VerdictFail` (exit 1).
- R4. `stryker merge` writes each project's thresholds and its file keys into the merged report as `projects`, so the gate needs no config read (ruling A). Files outside every listed project, which is every file of an unsharded run's report, are judged as one project `.` with the report's top-level thresholds.
- R5. The `--baseline` and `--budget-baseline` verdicts are unchanged and their existing scenarios still pass. A score above break with new baseline survivors still fails on the baseline verdict. The gate runs the baseline check, then the budget check, then the break check, and the first failure decides the exit.
- R6. Changeset: `@systemfsoftware/stryker-js` major, because a gate that passed today now fails. Migration: set `thresholds.break: null`, or raise the score. The README rows for `stryker gate` and exit code 1 say the gate judges the break.

### Acceptance (tests)

- A1 (journey, `shard-merge.integration.test.ts`, committed red first): the merged report below break → shards exit 0, gate exits 1, output names `score-below-break` and the threshold.
- A2 (journey, ruling A refusal, `shard-run-verdict.integration.test.ts`, which owns the two-project fixture): two projects, `first` with break 0 and `second` with break 50, all mutants surviving. The gate exits 1, names `second` only, and counts `1 of 2` projects. Applying the first project's break to every project would pass this run.
- A3 (workflow properties, `gate-score-break.workflow.property.test.ts`, drawing `ProjectScore`): a project fails iff it is `Scored` with a non-null break and percentage < break, with the breach naming its score and break; otherwise it passes, listing it as unscored iff `Unscored` with a break. Two projects: the error lists exactly the failing ones, in input order.
- A4 (schema laws, generated by `inSourceSchemaLaws`): `MergedProject` and `GateReportDocument` round-trip.
- Existing gate and budget scenarios in `tests/gate.integration.test.ts` and `tests/shard-merge.integration.test.ts` stay green unchanged.

Test layers (test-layer-selection admission gate): A3 is a decision, so it gets property tests only. A4 is a schema, so it gets codec laws. A1 and A2 spawn the built CLI, which the gate refuses as integration tests. They are admitted only as journeys under its "top-level failure contract" seam: the merge→gate handoff crosses two commands and a file. That makes two journeys, inside the 2-4 cap. Everything else is pushed down to A3/A4. No other test is admitted.

### Edge review (destructive pass, Edge-First lens)

- A merged report puts every file in a project, so `.` is empty and skipped. A multi-project report merged by an older CLI has no `projects` and a top-level break of null, so it gets no verdict. This is residual: `merge` and `gate` run from the same published CLI in one CI job (`.github/workflows/mutation.yml:330-340`).
- A report with no files has no score, so it gets no verdict and no "no valid mutant" line.
- When the baseline check fails first, the break failure is not reported. Both remediations ask for the survivors to be killed, and R5 keeps the existing verdicts unchanged.
- Projects are partitioned by explicit per-project `files` lists, not by path-prefix inference. Nested project directories would make prefixes ambiguous.

### Scope boundaries

- `stryker run` and the shard driver keep their exit behaviour.
- When two shards disagree on a project's thresholds, the first shard's thresholds win. All shards of a project load the same config.
- The dogfood config (`packages/toolchain/stryker-config/lib/base.js:25`, `break: 100`) is not touched. See Open questions.

## Implementation (small)

- U1 (landed `d360a08a1`). `packages/stryker-js/src/gate-score-break.workflow.ts`: `GateScoreBreakCommand { projects: [{ project, score, breakingThreshold }] }` → `ScoreAtOrAboveBreak { unscored }`, or the error `ScoreBelowBreak { breaches: [{ project, percentage, threshold }], projects }` with `code: 'score-below-break'` and `exitClass: 'VerdictFail'`. Each project goes through `classifyExit`. Properties A3.
- U2. `packages/stryker-js/src/shard/shard-merge.schema.ts`: `MergedProject { project, thresholds: RunEvent.VerdictThresholds, files }`. `shard-merge.ts` reads each project's thresholds from the last decodable `verdict` line of each shard stream, taking the first shard that has one; with none, the default thresholds (break null). It writes `projects` beside the existing `thresholds`, which stays as it is. Law A4.
- U3. `packages/stryker-js/src/gate-report.schema.ts`: `GateReportDocument` = `PriorReportDocument` plus `thresholds.break` and `projects`, both with decode defaults (`null`, `[]`). `run-request.cell.ts` `gateReport` decodes it, groups files into projects straight-line (no branch in the shell), computes each score with `metricsFromMutants(...).mutationScore`, and runs the U1 workflow after the budget check. `ScoreBelowBreak` joins `CliFailure` and owns its remediation, so `GATE_REMEDIATION_LINE` is not logged for it. The shard-run downgrade line names `stryker gate`.
- U4. Journey A2 in `shard-run-verdict.integration.test.ts`. README rows. Changeset.

## Open questions for the supervisor

- Q1. Main's Mutation run will fail at its gate step once a release carrying this change becomes the `stryker-published` input: the dogfood break is 100, and main scored 55.01 on run 37960922409. Set the shared config's break to null, set it to a floor below the current score, or accept the red?
