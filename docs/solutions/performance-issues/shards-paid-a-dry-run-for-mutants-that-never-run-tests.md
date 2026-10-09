---
title: Every shard paid its project's dry run, even when it held no mutant that runs tests
date: 2026-10-09
category: performance-issues
module: shard-planning
problem_type: performance_issue
component: tooling
symptoms:
  - "Every Mutation shard runs the stryker-js initial test run although most shards hold only CompileError or reused mutants of it"
  - "A shard leaf given only remembered CompileErrors still starts test runners before the mutation-test phase"
  - "Shard predictedSeconds ignore the dry run each shard executes"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [mutation-testing, sharding, dry-run, compile-error, checker, incremental-report, planner-replay]
---

# Every shard paid its project's dry run, even when it held no mutant that runs tests

## Problem

A shard leaf (`stryker run --plan … --shard …`) ran each project's initial test run before it looked at what its mutants needed. A shard holding only mutants whose last verdict was CompileError still paid the full dry run (about 92 s for stryker-js), although the checkers settle those mutants without a test. The planner spread each project's tested mutants across every shard, and `predictedSeconds` left the dry run out, so every shard paid it and no plan counted it.

## Symptoms

Planner replay on Mutation run 37883972540's record: the actual plan put the stryker-js dry run on 20 of 20 shards, with a modeled max shard time of 371 s. With dry-run affinity and the deferrable leaf, the same input yields 18 shards, a max of 298 s, and the stryker-js dry run on 6 of them.

## What Didn't Work

- **Skipping the dry run by flagging `DryRunDone`.** The first cut added `dryRunDeferred: boolean` to `DryRunDone` and filled `dryRunResult` with an empty `complete` result. Every consumer then had to check the flag before it trusted the result, and a deferred run that needed tests reached an `Effect.die`. Review rejected it (CONSTITUTION CONST-D4: don't encode a state by which fields are present). The deferred run is now its own branch over a `TestBasis` that never claims a dry run. `DryRunDone` keeps its shape.
- **Pricing a reusable dry run like a fresh one.** A dry run that the incremental record lets the shard reuse costs nothing, so the planner prices it at zero (`dryRunChoiceOf`, shared by leaf and planner).

## Solution

- **Leaf.** `requireDryRun` (`require-dry-run.workflow.ts`) decides before the dry run. With a checker configured, and without `--dryRunOnly` or `ignoreStatic`, a mutant doesn't depend on the dry run when every prior record of it is a CompileError and no prior flake refuses its reuse. If no mutant depends on it, `deferrable-dry-run.cell.ts` lets the checkers settle the plan first. When every mutant is rejected again, no test runner starts. When a checker accepts one, the run falls back to the tested path and scores that mutant as a forced run would.
- **Planner.** `plan-shards.workflow.ts` reserves the fewest bins per project that fit its dry-run-dependent mutants plus one dry run per bin under the target, and places those mutants only in their project's bins. `predictedSeconds` includes each fresh dry run.
- **Merge.** A deferred shard's report carries no `dryRunCoverage`. `incremental-union.ts` keeps the first coverage any shard carried, so the merged report keeps the coverage the next run reuses.

## Why This Works

A dry run is needed only for mutants that will execute tests. That depends on the shard's mutants and their prior verdicts, both known before the dry run starts. The planner can see the same facts, so it packs the dependent mutants together and prices only the dry runs the leaves will actually run.

## Prevention

- Judge a planner change by replaying it on a real run's record, not by reading `predictedSeconds`. The input is the parent run's merged incremental report. The to-run set is the mutants whose recorded `actualMs` changed between the parent's record and this run's. Check that set against the run's plan-log counts before trusting the replay. Dry-run costs come from the record's `dryRunCoverage` (test `timeSpentMs` sum plus `timeOverheadMs`). Gate: review. The reviewer cites the run id, the shard count before and after, and which shards pay each dry run.
  - wrong: "the new plan predicts fewer seconds."
  - right: "run 37883972540: stryker-js dry run on 20/20 shards before, 6/18 after, modeled max 371 s → 298 s."
- An oracle that looks up per-project data in a plain object must use own properties. A generated project named `toString` reads `Object.prototype.toString` and makes the oracle refute a correct planner. Gate: `pnpm --filter @systemfsoftware/stryker-js exec vitest run plan-shards.workflow.property`.
- A change to when the dry run runs must keep both CompileError-reuse scenarios green: the CompileError-only leaf starts no test runner and keeps the first run's verdicts, and an accepted mutant scores as a forced run does. Gate: `pnpm --filter @systemfsoftware/stryker-js exec vitest run compile-error-reuse.integration`.
