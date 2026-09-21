---
title: Do not sleep in a test to prove a mutation timeout
date: 2026-09-21
category: tooling-decisions
module: stryker-js-family
problem_type: tooling_decision
component: testing_framework
severity: high
applies_when:
  - "An end-to-end mutation journey must fail when a finite mutant is clipped by the wall-clock cap"
  - "The obvious proof is a covering test that sleeps longer than the mutant timeout"
  - "The pass condition of the lane must not move with machine speed"
tags: [mutation-testing, timeout, e2e, hit-limit, wall-clock]
---

# Do not sleep in a test to prove a mutation timeout

## Context

A mutation lane that blesses survivor or timeout counts from one machine fails on another when dry-run overhead plus a short absolute timeout clips finite work. The replacement detects non-termination with a hit bound on one named loop, and treats a wall-clock clip of a finite mutant as a broken run.

## Guidance

Prove the clip with `stopWallClock` and `wallClockTimeoutStopsRun`. A timeout whose reason is not the hit-limit prefix fails the stage and does not record a mutant. Do not add a covering test that calls `setTimeout` or otherwise sleeps so the cap is sure to win.

A sleep long enough to beat overhead on a fast box can finish inside the overhead on a slow box. That is the machine-dependent pass the design rejected.

The named trap is a finite loop in the dry run and a loop that cannot finish when mutated. Its covering test declares no timeout of its own. The runner names the trap file. The classifier reports Timeout only when the active mutant is that trap.

## Why This Matters

A green journey that waited out a sleep shows that the sleep was longer than that machine's budget. It does not show that the clip failed the run. The next machine can invert the result without a code change.

## Architectural Invariants

Let `B` be the mutant budget (`timeoutFactor * netTime + timeoutMS + overhead`) and `S` a sleep in a covering test.

- If `S > B` on machine A and `S < B` on machine B, the clip fires on A and not on B. The journey is not a predicate.
- Timeout is legal only for the named trap, and only from a hit bound on a path that loop executes.
- A wall-clock synthesis (`withTimeout` setting `WALL_CLOCK_TIMEOUT_REASON`) is a stage failure, not a mutant status.

```text
if reason is hit-limit prefix and mutant is the named trap -> Timeout
if reason is hit-limit prefix and mutant is not the trap -> Killed
if status is timeout and reason is not the hit-limit prefix -> fail the stage
else -> classify from covering-test pass or fail
```

## When to Apply

Apply when a journey or fixture is about to wait on the wall clock to classify a mutant. Do not apply to the dry-run timeout, which is a separate absolute budget for the initial test run.

## Examples

`wallClockTimeoutStopsRun` returns true for a bare timeout and for `WALL_CLOCK_TIMEOUT_REASON`, and false for a reason that starts with `HIT_LIMIT_REASON_PREFIX`. `stopWallClock` fails the mutation-test stage on that true result before the result is recorded.

The trap function `accrue` finishes for a finite count. Its covering test calls that count and sets no test timeout. The resilience config names that file as `timeoutTrapFile`.
