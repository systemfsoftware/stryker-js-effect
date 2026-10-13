---
title: Mutation Verdict - Plan
type: refactor
date: 2026-10-13
supersedes: section U6 of docs/plans/2026-10-12-1732-refactor-grab-bag-decomposition-plan.md
topic: grab-bag-decomposition
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Mutation Verdict - Plan

## Goal Capsule

- **Objective:** the score-vs-`thresholds.break` decision is a mutated workflow, a cell writes its log lines, and `classifyExit` decides only precedence, with exit codes and verdict log lines unchanged.
- **Authority:** unit U6 of `docs/plans/2026-10-12-1732-refactor-grab-bag-decomposition-plan.md` (carried by #317). This plan replaces that section for U6 only; every other unit, requirement (R4, R10, R14, R15) and decision (KTD9, KTD11, KTD12) of the parent plan stands.
- **Why superseded:** U6's review confirmed a schema-laws violation (`breakingThreshold: S.NullOr(Report.Percentage)` carried "no threshold" by a null); the fix decoded the field into a tagged union, and its generated codec laws required a real encode. The parent's U6 bullets still described the nullable field, and the re-review confirmed that drift (two P3s). The approach and test scenarios below state the codec; nothing else in U6 changes.
- **Delivery:** one PR off `main` (#317).

## Implementation Unit

### U6. Mutation verdict (PR 6, #317)

**Goal:** the score-vs-threshold decision is a mutated workflow, a cell writes its log lines, and `classifyExit` decides only precedence.

**Requirements:** R4, R10, R14, R15; KTD9, KTD11, KTD12.

**Dependencies:** U3 (stacked on #297): U6's span entry edits two files #297 edits (KTD12). U6's branch starts from #297's head, where its line references hold (P25). U7 stacks on it.

**Refreshed 2026-10-12 on `main` ddeb67ab5.** The verdict region is unchanged since this plan's base; only its line numbers moved (P20). Line references below are ddeb67ab5's, and they hold on #297's head 23323f361 (P25).

**Files:**

- Create `src/judge-mutation-score.workflow.ts`, `src/mutation-verdict.cell.ts`, `src/__tests__/judge-mutation-score.workflow.property.test.ts`, `tests/drain-failure-outranks-verdict.integration.test.ts`, and a `.changeset` file (`@systemfsoftware/stryker-js` and `@systemfsoftware/stryker-js-cli-contract`: patch).
- Modify `src/classify-exit.workflow.ts` (the command keeps only `pending`, each decision variant carries its `exitClass`, and the `Report` import goes), `src/__tests__/classify-exit.workflow.property.test.ts`, `src/mutation-reporting.service.ts` (delete `:739-803`, rewrite `:946-965`, add one import line after `:49`), and this plan.
- Modify `packages/stryker-js-cli-contract/src/SpanTaxonomy.ts` (one `mutationReportingJudgeScore` entry among the `mutationReporting*` entries at `:86-97`) and `packages/stryker-js-cli-contract/contract/span-taxonomy.json`, regenerated with that package's `generate:contract` script. No other cli-contract file changes (P25).

**Approach:**

- `judgeMutationScore` takes `{ score: Report.MutationScore, breakingThreshold: BreakThresholdFromOption }` and decides one of five variants, one per log branch on `main`: `ScoredWithoutThreshold { percentage }` (the debug line at `:767-770`), `ScoreAtOrAboveThreshold { percentage, threshold }` (the info line at `:772-776`), `ScoreBelowThreshold { percentage, threshold }` (the error and info lines at `:793-801`), `UnscoredAgainstThreshold { threshold }` (the info line at `:783-789`) and `UnscoredWithoutThreshold` (no line, `:782`). Each variant carries a single-valued `exitClass`: `S.tag('VerdictFail')` on `ScoreBelowThreshold`, and `null` on the other four through a plain `S.Null` that every `.make` site passes, because `S.tag` admits only string, number, boolean and bigint (`effect` 4.0.0 `SchemaAST.d.ts:934`). Every arm returns a variant, never `null`, so the null-to-`undefined` mutants that survive today (P22) change the decision and are killed.
- `BreakThresholdFromOption` is the command field's codec, declared in the workflow file: `S.NullOr(Report.Percentage)` (the options' `thresholds.break`) decodes to the tagged union `NoBreakThreshold | BreakAt { threshold }` and encodes back (`NoBreakThreshold` to `null`, `BreakAt` to its threshold), so no command carries the threshold's state by a field's presence (schema-laws `tagged-unions-over-state-by-presence`, CONST-D4) and the generated in-source codec laws hold. `decide` dispatches on the tag with `Match.valueTags`.
- `mutation-verdict.cell.ts` is `Sandwich.named(SpanTaxonomy.Spans.mutationReportingJudgeScore.name)(read).decide(judgeMutationScore).write(handlers)` (KTD12). Its read passes the metrics' score and `options.thresholds.break` as encoded values; the `Sandwich` decodes them through the command schema, so `null` becomes `NoBreakThreshold`. Each variant's handler writes that variant's lines at `main`'s level and with `main`'s text (`percentage.toFixed(2)`, `String(threshold)`), then answers the variant's `exitClass`.
- The `CommandRejected` handler answers `'InternalError'`. The command is encoded from values that are already decoded, so a refusal is a defect of the run, which is the class `InternalError` names.
- `classifyExit` keeps `PRECEDENCE` (`classify-exit.workflow.ts:49-54`) and decides `ExitPassed` (`exitClass` `null`) or the variant of the most severe pending class, each carrying its class in a single-valued field as above. The score branch (`:65-78`, and its use at `:81-88`) goes.
- `reportAll` keeps its order and its two steps (KTD11): it drains the reporter stage (`:945`), runs the cell, and asks `classifyExit` once over `[verdict, terminalDrain]`; the result is `decision.exitClass`. Both reverse maps go: `:749-750` with `determineExitCode`, and `:958-963`. A breaking score now enters precedence as a pending `VerdictFail`, so a drain `RuntimeError` outranks it by construction rather than by the order of two calls.
- To stay clear of #298 and #271 (P23), the PR leaves the `classify-exit` import at `:42` byte-identical, adds the cell import as its own line after `:49`, deletes exactly `:739-803`, rewrites only `:946-965`, keeps the binding name `finalVerdict`, and leaves `:967-974` alone. #298's hunks (`:59-65` and later) and #271's hunks (`:36-48` around `:42`, `:705-734`, `:936`, `:970`) are then separated from U6's by unchanged lines, so either can merge after U6 with no textual conflict in this file.

**Patterns to follow:** `src/classify-exit.workflow.ts` (decision variants declared in the workflow file); `src/clear-text-report.cell.ts:121-128` (a `Sandwich` named by a `SpanTaxonomy` entry whose write handlers produce the cell's output); #297's `stryker.sandbox.prepare` entry (a span added to both cli-contract files with a patch changeset) (pack: cell-architecture, sandwich-phase-order.md).

**Test scenarios:**

- `judgeMutationScore`, over `Report.MutationScore` and the decoded threshold `S.toType(JudgeMutationScoreCommand.fields.breakingThreshold)` (the workflow callable takes the command's `Type`; the codec's round trip is owned by the generated in-source codec laws):
  - The variant is the one the score's tag, the threshold's tag and the comparison select, and its `percentage` and `threshold` equal the input's. Fails if `NoBreakThreshold` is read as a threshold of 0 (a scored run with no threshold would land in `ScoreAtOrAboveThreshold`), if an unscored run is judged against a threshold, or if an arm returns `undefined`.
  - `exitClass` is `'VerdictFail'` iff the score is `Scored`, the threshold is `BreakAt`, and its threshold exceeds the percentage. The oracle does not compare with `<` the way the code does (for example `Order.lessThan(Order.Number)` with swapped operands, or `Math.sign`).
  - For a drawn percentage `p`, `Scored { p }` against a threshold of `p` passes. Independent draws almost never tie (P22), so this law draws the tie; it targets `<` → `<=`, which only a CI Mutation report confirms as killed.
- `classifyExit`: for a drawn `pending` array of any length, including empty, `exitClass` is the most severe pending class by the test's own severity oracle (`codeOf`, `classify-exit.workflow.property.test.ts:19-26`), or `null` when the array is empty. The old pair and single laws are consolidated into this one law, whose draws include arrays of length 1 and 2, and the score arguments go. `∀st_Command_≡VerdictFailedIffScoredBelowThreshold` moves to the judge's file with the logic it grades (R17: moved, not deleted). No law restates that a variant's class matches its tag, because a single-valued field makes that a type fact.
- R15 citations (KTD9): run 38239240750, artifact `mutation-report-444` (P22). U6 deletes the code of `2c6daf224e727981`, `354e6d1d3c4dc374`, `5f1b04c8d61df244` and `6cea2aa080723204`, so the PR reports them as deleted. It also names the mutant classes the new laws target in that logic's new home: an arm returning `undefined`, and `<` → `<=`. Whether they die is read from the first `main` Mutation report after merge (the nightly run, or a dispatch by Stream K or the root), never from a local or hand-applied mutant (operator rule, 2026-10-12).
- Integration, unchanged and run: `tests/break-threshold-exit.integration.test.ts` (a score under the threshold exits 1 in both modes; no threshold exits 0) and `tests/shard-run-verdict.integration.test.ts` (children failing the threshold; the shard exits 0). `tests/slow-reporter-terminal-report.integration.test.ts` and `tests/gate.integration.test.ts` stay green but do not grade U6 (P21).
- `tests/drain-failure-outranks-verdict.integration.test.ts` pins P17's precedence, which no suite grades (P21), through the surface a user has: the built CLI (`dist/main.mjs run`) on a consumer project, as `tests/break-threshold-exit.integration.test.ts` does (operator rule, 2026-10-12: an integration test drives the built CLI or the published API and asserts only what a user observes). The reporter is a plugin loaded from disk through the config's `plugins` (`tests/__fixtures__/refusing-reporter/`), whose worker refuses the batch that carries `mutationTestReportReady`. A scenario outline runs the same project, whose tests kill no mutant, at a break threshold of 100: reporting also to that plugin it exits 3; reporting only to `json` it exits 1. Each row also decodes the `verdict` record from stdout with `RunEvent.VerdictReached` and checks its score is under the threshold, so exit 3 is the reporter failure outranking a broken score, not a run that never scored. The published documented API (`strykerCell`, `./promises` `run`) takes its base path from the working directory (`run/RunEnvironment.service.ts:84`), so an in-process run would have to change the process's directory; `Engine.mutationTestCell` and `Engine.RunEnvironment.stage` are exported but documented nowhere and serve the CLI's own wiring.
- No scenario asserts span parentage or span emission. The span's name is published (`contract/span-taxonomy.json`), its parentage is not (each entry carries only `id`, `name` and `attributes`, `packages/stryker-js-cli-contract/scripts/contract-documents.ts:23-35`), and the CLI exports spans only through undocumented `OTEL_*` variables (`packages/stryker-js/src/bin/main.ts:121-138`).
- No suite asserts the four log texts (P21). Before and after the change, a throwaway script under `.scratch/` (gitignored, `.gitignore:17`) captures the log lines (level and text) that the verdict path writes for each of the five outcomes. Before the change it calls the old path. After, it calls `mutationVerdictCell.run`. It drives each path with five fixed `{ score, breakingThreshold }` inputs under a capturing `Logger`, then diffs the captures. The inputs are a deliberate fixture of one per variant: whole runs cannot cheaply produce an unscored outcome. The script is deleted before the landing commit and is not a committed test (harness rule OP12).

**Verification:** `classify-exit.workflow.ts` no longer imports `Report`. `git grep -nIE "determineExitCode|logScoredPass|logUnscored|logBroken" -- . ':!*.lock' ':!docs/plans'` returns no matches (harness rule DEL1; plans are excluded because they name the removed symbols as history). The five-outcome log diff is empty, and the before and after captures go in the PR body only. Exit codes in the listed suites are unchanged. `git diff` against #297's head shows only the three named hunks in `mutation-reporting.service.ts`, and in `packages/stryker-js-cli-contract` only the `mutationReportingJudgeScore` entry in its two files. The cli-contract suite passes, including `contract-documents.integration.test.ts`, which checks `span-taxonomy.json` against the taxonomy. The PR body cites `mutation-report-444` and reports the four survivors as deleted.
