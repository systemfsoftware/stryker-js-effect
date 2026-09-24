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
  - "An oracle asserting `noCoverage > 0` for an uncovered fixture function fails because the lane reports those mutants as `Survived` with `counts.noCoverage` 0"
  - "An oracle reading `coveredBy` from the JSON report finds the field absent on every mutant"
  - "An oracle resolving killedBy ids to test names through `testFiles` throws because `testFiles` is empty in the written report"
tags:
  - e2e-oracle
  - mutation-report
  - vm-runner
  - coverage
---

# Context

Hardening the vm-vitest container oracle (`VM_VITEST_ORACLE` and its step verifiers) surfaced
three facts about what this lane can observe. Each was verified against a live container run:
the fixture gained a dead exported function, the config gained `reporters: ['json']`, and the
oracle was iterated until green.

# Guidance

1. Uncovered mutants are classified `Survived`, not `NoCoverage`. Adding a dead exported function
   to the fixture moved its two mutants into the `Survived` tally while `counts.noCoverage`
   stayed 0. Assert the no-coverage canary as extra survivors with no killers, never as a
   NoCoverage status.
2. The JSON report — whose path the terminal verdict event carries in `reportFile`, relative to
   the fixture root — writes `killedBy` on mutants but not `coveredBy`. Coverage attribution must
   ride the counts/tally and `killedBy` presence, never a coverage dictionary.
3. `testFiles` in the JSON report is empty because the vm runner's dry-run `TestResult` entries
   carry no `fileName`, and report assembly groups tests by file name. killedBy ids (`'0'`,
   `'1'`, ...) therefore cannot be resolved to test names from the report. Pin attribution by
   killer arity instead: the fixture's `add` mutant must carry exactly one killedBy entry, and
   every killed mutant at least one.
4. Per-mutant location pins are stable: the dead function's ArithmeticOperator mutant sits at a
   known `location.start.line` and must appear as `Survived` with an empty `killedBy`.

A silent-pass regression (kills misclassified as survivors) changes the tally, empties
`killedBy`, or breaks the single-killer arity, so the oracle still catches it.

# Architectural Invariants

**Oracle-field invariant:** an e2e oracle may pin only fields the report schema provably encodes;
an attribution claim riding a field the encoder never writes either fails loud forever or — worse,
after an optional-field widening — passes vacuously. Before asserting a report field, decode one
real report from the lane and check the field survives encoding.

**Status-mapping invariant:** fixture-level coverage detection asserts observable classification
(tally shape, killer presence), not a coverage bookkeeping category whose mapping to statuses is
runner-owned and may collapse uncovered work into `Survived`.

# Applicability note

These constraints describe the current report contract of this CLI and the vm runner's monolithic
per-test mapping. If `TestResult` gains a `fileName` or the reporter starts emitting
`coveredBy`, name-level attribution becomes possible and the arity pin should be replaced by a
stronger name assertion.
