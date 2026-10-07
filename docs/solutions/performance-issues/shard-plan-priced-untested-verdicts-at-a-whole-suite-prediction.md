---
title: Shard plans balanced on CompileError counts because untested verdicts recorded no cost
date: 2026-10-07
category: performance-issues
module: shard-planning
problem_type: performance_issue
component: tooling
symptoms:
  - "Mutation shards finish minutes apart although the plan predicts equal shard seconds"
  - "Every shard receives an almost identical count of CompileError mutants"
  - "The incremental report's costs entries for CompileError, NoCoverage and Ignored mutants have actualMs null"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [mutation-testing, sharding, lpt, cost-record, compile-error, incremental-report]
---

# Shard plans balanced on CompileError counts because untested verdicts recorded no cost

## Problem

`stryker plan` bin-packs mutants longest-first at `costs[id].actualMs ?? costs[id].predictedMs`. A verdict reached without running a test (CompileError, NoCoverage, Ignored) recorded no cost, so `actualMs` was null. The plan then priced it at `predictedMs`, the summed time of every test covering that mutant, even though no test would run for it.

## Symptoms

Main Mutation run 37602076567: stryker-js had 3547 CompileError mutants priced at about 68 s each, 241,914 s in total. All its Killed and Survived mutants together measured 3,216 s. The planner therefore balanced CompileError counts (177 or 178 per shard), while the test time each shard actually ran ranged from 88 s to 237 s. Shard wall time follows the test time (99 s + 1.51 × test seconds, r = 0.91), so the Mutation step ranged from 271 s to 498 s across shards.

## What Didn't Work

- **Pricing untested verdicts at 0.** LPT places each zero-cost item into the bin that is currently least loaded, and that bin does not change while only zero-cost items are being placed. Every check would land in a single shard.
- **Capping CompileErrors per shard.** This is a second heuristic layered on the first, not a measurement.

## Solution

Record what each verdict measurably cost. The checker pool times each `check` call and splits the elapsed time evenly across that call's mutants. A mutant that several checkers see sums its shares. A CompileError, or a NoCoverage verdict that a checker looked at, carries `{ fixedOverheadMs: checkShare, testBodyMs: 0, testsExecuted: 0 }` as its verdict cost. An Ignored verdict, or NoCoverage with no checker, records 0 because nothing ran. The run budget still prices only verdicts that ran a test (`decidedWithoutATest` in `mutant-cost.ts`), so budget gates are unchanged.

## Why This Works

The planner's fallback assumes a mutant with no recorded cost will run its covering tests. That holds for a mutant that was never measured. It does not hold for a mutant whose verdict a checker or the coverage map has already decided. Once these verdicts carry a measured cost, the plan prices the work that will actually happen.

## Prevention

- A new verdict path must record a finite `costs[id].actualMs`. If it records null, the planner falls back to the whole-suite prediction. Gate: `pnpm --filter @systemfsoftware/stryker-js exec vitest run tests/check-cost-record.integration.test.ts tests/plan-recorded-costs.integration.test.ts`.
  - wrong: a new early verdict is returned without a `cost`.
  - right: it carries `checkOnlyCostOf(measuredMs)`, or 0 when nothing ran.
- Judge plan quality by comparing per-shard Mutation-step seconds (from the run's jobs API) with per-shard recorded test seconds (from the merged report). The plan's `predictedSeconds` is not evidence. Gate: review. The reviewer cites both numbers by run id.
  - wrong: "the plan predicts equal shards."
  - right: "run 37602076567: Mutation step 271–498 s, recorded test time 88–237 s per shard."
