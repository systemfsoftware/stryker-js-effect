---
title: The vm-vitest e2e oracle must pin attribution through killedBy arity and location, not coverage dictionaries
date: 2026-09-21
category: best-practices
module: e2e-lane
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - extending or tightening the vm-vitest container e2e oracle
  - interpreting the mutation JSON report written by the `json` reporter in this CLI
  - deciding which mutant statuses an e2e fixture can legitimately assert
symptoms:
  - "An oracle treats an uncovered fixture function's mutants as run survivors; under per-test coverage they are planned `NoCoverage` and never dispatched, and under `off`/`all` they still run"
  - "An oracle reading `coveredBy` from the JSON report finds the field absent on every mutant"
  - "An oracle resolving killedBy ids to test names through `testFiles` throws because `testFiles` is empty in the written report"
tags:
  - e2e-oracle
  - mutation-report
  - vm-runner
  - coverage
---

# Context

Hardening the vm-vitest container oracle surfaced three facts about what this lane can observe. The report-shape facts were verified against a live
container run: the fixture gained a dead exported function, the config gained `reporters:
['json']`, and the oracle was iterated until green. The status the uncovered mutants carry is now
the planner's contract, asserted by its property suite rather than read off a run.

# Guidance

1. Under per-test coverage analysis — the default — a non-static mutant no test reaches is
   planned `NoCoverage` without a mutant run, so the dead exported function's mutants land in
   `counts.noCoverage` and carry no `killedBy`. Under `coverageAnalysis: 'off'` or `'all'` an
   uncovered mutant still runs and typically ends `Survived`. Assert the canary against the mode
   the fixture configures. (Produced by `plan-mutant-tests.workflow.ts`; pinned by the
   per-test/uncovered law in its property suite.)
2. The JSON report — whose path the terminal verdict event carries in `reportFile`, relative to
   the fixture root — writes `killedBy` on mutants but not `coveredBy`. Coverage attribution must
   ride the counts/tally and `killedBy` presence, never a coverage dictionary.
3. `testFiles` in the JSON report is empty because the vm runner's dry-run `TestResult` entries
   carry no `fileName`, and report assembly groups tests by file name. killedBy ids (`'0'`,
   `'1'`, ...) therefore cannot be resolved to test names from the report. Pin attribution by
   killer arity instead: the fixture's `add` mutant must carry exactly one killedBy entry, and
   every killed mutant at least one.
4. Per-mutant location pins are stable: the dead function's ArithmeticOperator mutant sits at a
   known `location.start.line` and, under per-test coverage, must appear as `NoCoverage` with an
   empty `killedBy`.

A silent-pass regression (kills misclassified as survivors) changes the tally, empties
`killedBy`, or breaks the single-killer arity, so the oracle still catches it.

# Architectural Invariants

**Oracle-field invariant:** an e2e oracle may pin only fields the report schema provably encodes;
an attribution claim riding a field the encoder never writes either fails loud forever or — worse,
after an optional-field widening — passes vacuously. Before asserting a report field, decode one
real report from the lane and check the field survives encoding.

**Status-mapping invariant:** fixture-level coverage detection asserts observable classification
(tally shape, killer presence) against the mode the fixture configures: a non-static mutant no
test reaches is `NoCoverage` only under per-test coverage analysis, and still runs under
`off`/`all`. Do not assert a coverage bookkeeping category whose mapping to statuses is
runner-owned.

# Applicability note

These constraints describe the current report contract of this CLI and the vm runner's monolithic
per-test mapping. If `TestResult` gains a `fileName` or the reporter starts emitting
`coveredBy`, name-level attribution becomes possible and the arity pin should be replaced by a
stronger name assertion.
