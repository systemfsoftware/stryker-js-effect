---
title: Do not sleep in a test to prove a mutation timeout
date: 2026-09-21
category: tooling-decisions
module: stryker-js-family
problem_type: tooling_decision
component: testing_framework
severity: high
applies_when:
  - "An end-to-end mutation journey must pin a mutant reported as Timeout"
  - "The obvious proof is a covering test that sleeps longer than the mutant timeout"
  - "The pass condition of the lane must not move with machine speed"
tags: [mutation-testing, timeout, e2e, hit-limit, wall-clock]
---

# Do not sleep in a test to prove a mutation timeout

## Context

A mutation lane that blesses survivor or timeout counts from one machine fails on another when dry-run overhead plus a short absolute timeout clips finite work. The replacement detects non-termination with a hit bound on one named loop, and also reports the wall-clock backstop as a mutant `Timeout` rather than failing the run.

## Guidance

Do not add a covering test that calls `setTimeout` or otherwise sleeps so a wall-clock cap is sure to win. A timeout is proved either by the named hit-bound trap or by a mutant whose covering test genuinely never settles; a sleep only shows that the sleep was longer than that machine's budget.

A sleep long enough to beat overhead on a fast box can finish inside the overhead on a slow box. That is the machine-dependent pass the design rejected.

The named trap is a finite loop in the dry run and a loop that cannot finish when mutated. Its covering test declares no timeout of its own. The runner names the trap file. The classifier reports Timeout when the hit bound fires on that trap, and also when the wall-clock backstop clips a mutant that never settles. A clipped mutant is recycled into a fresh worker and the run continues; the clipped mutant still counts as detected in the score.

## Why This Matters

A green journey that waited out a sleep shows that the sleep was longer than that machine's budget. It does not show that the clip was classified. The next machine can invert the result without a code change.

## Architectural Invariants

Let `B` be the mutant budget (`timeoutFactor * netTime + timeoutMS + overhead`) and `S` a sleep in a covering test.

- If `S > B` on machine A and `S < B` on machine B, the clip fires on A and not on B. The journey is not a predicate.
  Gate: review — the reviewer confirms no committed journey or fixture classifies a mutant by sleeping.
- Timeout is legal from the named trap's hit bound, and from the wall-clock backstop clipping a mutant whose covering test never finishes. Both are mutant statuses.
  Gate: `pnpm --filter @systemfsoftware/stryker-js test` — `wall-clock-timeout.integration.test.ts` and the `interpret-vitest-mutant-run` property tests fail when either source stops reporting `Timeout`.
- The wall-clock backstop kills and replaces the hung worker (`Pool.invalidate`) and the run continues; it does not fail the stage, and it never produces exit code 4.
  Gate: `pnpm --filter @systemfsoftware/stryker-js test` — `wall-clock-timeout.integration.test.ts` asserts the run completes, the clipped mutant is a wall-clock `Timeout`, and the verdict is not `InternalError`.

```text
if reason is hit-limit prefix and mutant is the named trap -> Timeout
if reason is hit-limit prefix and mutant is not the trap -> Killed
if status is timeout and reason is wall-clock -> Timeout, recycle the worker, continue the run
else -> classify from covering-test pass or fail
```

## When to Apply

Apply when a journey or fixture is about to wait on the wall clock to classify a mutant. Do not apply to the dry-run timeout, which is a separate absolute budget for the initial test run.

## Examples

A mutant whose covering test awaits a promise that never settles is reported `Timeout` with reason `wall-clock-timeout`. The mutation-test loop invalidates the pool slot so the hung worker is killed and replaced, records the mutant through the ordinary reporting path, and carries on with the remaining mutants.

The trap function `accrue` finishes for a finite count. Its covering test calls that count and sets no test timeout. The resilience config names that file as `timeoutTrapFile`.
