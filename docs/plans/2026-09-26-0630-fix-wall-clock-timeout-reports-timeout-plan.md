---
title: Wall-Clock Timeout Is a Detected Mutant - Corrected Contract
type: fix
date: 2026-09-26
topic: wall-clock-timeout-reports-timeout
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
supersedes: docs/plans/2026-09-21-1825-refactor-machine-invariant-mutation-oracle-plan.md
execution: code
---

# Wall-Clock Timeout Is a Detected Mutant - Corrected Contract

## Goal Capsule

- **Objective:** A mutation run that contains a mutant whose covering test never settles finishes. That mutant is reported `Timeout` and the run continues with the remaining mutants.
- **Means:** The mutation-test loop treats a wall-clock timeout result the same way it treats the hit-bound trap result: it records the mutant through the ordinary reporting path and recycles the pool slot so the hung worker is killed and replaced.
- **Product authority:** Governs the condition under which a mutant may be reported `Timeout`. It reverses the wall-clock clause of the plan it supersedes; every other clause of that plan (the hit-bound trap, machine-invariant finite classification, the score definition) is carried forward unchanged.

## Product Contract

### Summary

The lane stops blessing wall-clock counts from one machine and asserting them on another. Finite mutants are killed or survived from test results. One constructed infinite loop comes back as Timeout, detected by a hit bound. A mutant whose covering test never settles also comes back as Timeout, detected by the wall-clock backstop; the run recycles its worker and continues. A wall-clock timeout is a detected mutant, never a broken run.

### Problem Frame

In the consumer monorepo (`systemfsoftware/systemfsoftware`) seven Effect daemon packages abort every Mutation run with exit code 4 and no printed reason (run `36222008526`). The cause is a mutant whose test run exceeds the wall-clock budget: `withTimeout` synthesizes `{ status: 'timeout', reason: 'wall-clock-timeout' }`, and the mutation-test loop invalidated the pool slot with a `ChildProcessCrashedError` and failed the stage. Async Effect code hangs without growing any hit counter, so the hit-bound trap cannot see those mutants; the wall clock is the only bound that does.

### Key Decisions

- **A wall-clock Timeout is a detected mutant, not a broken run.** (reversed 2026-09-26: the hit bound cannot see an async hang that grows no counter, so the wall clock is the only bound that sees it; a clip recycles the worker and is recorded like any other mutant.) Governs R4, R8.
- **Recycle without failing.** The pool slot is invalidated (`Pool.invalidate`) so the hung worker is killed and replaced, but the loop does not `Effect.fail`. Governs R4.
- **Carry forward the hit-bound trap.** The named-trap classification and the machine-invariant finite classification are unchanged. Governs R2, R3.

### Requirements

**Verdict**

- R1. A journey pass or fail is identical on any machine that can run the covered tests to completion. Core count, load, and wall-clock must not change that verdict.
- R2. The classifier emits Killed when at least one covering test fails, and Survived when every covering test passes. It never invents a status for a mutant whose tests completed.
- R3. The hit-bound trap reports Timeout for one constructed infinite loop that cannot finish; the bound sits on a path that loop actually executes and does not depend on CPU speed. The wall-clock backstop separately reports Timeout for a mutant that never settles, and recycles its worker.
- R4. If the wall-clock backstop reports Timeout, the run invalidates the pool slot so the hung worker is killed and replaced, records the mutant, and starts further mutants. That result is a detected mutant, not a broken budget.
- R5. No journey pins Killed, Timeout, or Survived to a count, floor, or band taken from a bless run on one machine. Exact pins remain allowed for compile errors, ignored, no coverage, runtime errors, pending, and total.
- R6. The hit-bound trap does not wait out a wall-clock budget; the wall-clock backstop waits only for the mutant that never settles, never for finite work.

**Score**

- R7. The customer mutation score still treats Timeout as detected, in the same bucket as Killed. This work does not change that score definition.
- R8. The live process seam proves the constructed loop reported Timeout and a mutant that never settles reported Timeout with the run continuing. The finite classification law in R2 is proved on the pure decision, not by adding journeys that pin a status matrix.

### Key Flows

- F2. Constructed infinite loop
  - **Trigger:** the constructed loop mutant is activated.
  - **Steps:** the loop cannot finish. A hit bound fires. No shorter test timeout returns first.
  - **Outcome:** the mutant is Timeout. The wait is the bound, not a wall-clock cap.
  - **Covers:** R3, R6
- F3. Work clipped by a clock
  - **Trigger:** the wall-clock cap interrupts a mutant whose covering test never settles.
  - **Steps:** the loop invalidates the pool slot, reports the mutant as Timeout, and continues.
  - **Outcome:** the clipped mutant is recorded as Timeout and the run keeps going.
  - **Covers:** R4, R8

### Acceptance Examples

- AE2. Loop is Timeout without a clock wait
  - **Given:** the constructed infinite loop, and a covering test with no timeout shorter than the hit bound.
  - **When:** the mutant is activated.
  - **Then:** the status is Timeout, and the run did not sit for a wall-clock cap to decide it.
- AE3. Clock clip is a detected mutant
  - **Given:** a mutant whose covering test never settles.
  - **When:** the wall-clock cap reports that mutant Timeout.
  - **Then:** the mutant is recorded as Timeout with reason `wall-clock-timeout`, its worker is replaced, and the run finishes with the exit code from the score, never 4.

### Scope Boundaries

- Customer mutation-score math stays as documented. Timeout remains detected.
- No new bless of a timeout floor or a survived band from one machine.
- Interactive terminal output is out of scope.
- Additional end-to-end journeys that re-pin Killed, Timeout, or Survived matrices are refused.

---

## Implementation Units

### U1. Recycle and report a wall-clock timeout

- **Goal:** A wall-clock timeout result no longer fails the mutation-test stage. The pool slot is invalidated and the mutant is reported normally.
- **Requirements:** R3, R4, R6, R7. Covers AE3.
- **Files:** `packages/stryker-js/src/run/mutation-test.parts.ts`.
- **Approach:** In the mutant-run loop, when `invalidatesRunnerPool` holds, call `Pool.invalidate` alone instead of `invalidateSlot` with a synthesized crash. Delete `stopWallClock` and `wallClockTimeoutStopsRun` and the in-source property test that pinned the fatal behaviour. Leave the `OutOfMemoryError` and `ChildProcessCrashedError` paths as they are.
- **Test scenarios:**
  - Covers AE3. A wall-clock timeout result is reported and the loop proceeds to the next mutant.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js test` — the in-source tests of `mutation-test.parts.ts` pass and the old fatal-behaviour property is gone.

### U2. Regression test at the owning layer

- **Goal:** One test proves the whole behaviour through the shipped engine: the run finishes, the never-settling mutant is `Timeout` with reason `wall-clock-timeout`, its siblings keep their statuses, and the exit is never the internal-error code.
- **Requirements:** R3, R4, R7, R8. Covers AE3.
- **Layer admission:** Known-bug regression, per the test-layer table's regression row (deterministic regression test colocated with integration). It drives the published programmatic surface `Engine.mutationTestCell.run`; the child worker is spawned by the production composition, not by the test.
- **Files:** `packages/stryker-js/tests/wall-clock-timeout.integration.test.ts`.
- **Approach:** Write a workspace whose module has an `if` guard the classifier mutates to `false`, so the covering test awaits a promise that never settles, with finite mutants beside it. Run with a short `timeoutMS`. Read the report and the event stream.
- **Test scenarios:**
  - Covers AE3. The run completes and reaches a verdict; a mutant is `Timeout` with reason `wall-clock-timeout`; at least one sibling is `Killed`; the verdict is not `InternalError`.
- **Verification:** The test fails on the pre-change loop (the stage fails, so the run does not complete) and passes after it.

---

## Verification Contract

- U1: `pnpm --filter @systemfsoftware/stryker-js test`
- U2: `pnpm --filter @systemfsoftware/stryker-js exec vitest run tests/wall-clock-timeout.integration.test.ts`
- Lane gate: `pnpm check:ci`.

---

## Definition of Done

- R1 through R8 hold.
- No journey pins Killed, Timeout, or Survived to a blessed count, floor, or band.
- The named trap is Timeout without waiting out a wall-clock cap.
- A wall-clock clip is recorded as Timeout once and the run continues.
- The customer score still counts Timeout as detected.
- `pnpm format:check`, `pnpm typecheck`, and `pnpm test` pass for the packages this plan touches.

## Risks

- The vitest default test timeout is 5 seconds. The regression fixture sets a mutant budget below it so the wall clock wins; a slower machine must stay under the budget for the finite mutants.
- A runner other than the vitest plugin is out of this plan.

## Deferred to Follow-Up Work

- Human-mode runs still print no reason when the wall clock clips a mutant; this plan classifies the mutant but does not add a diagnostic line.
- Hit-bound parity for the in-memory VM runner, if a journey starts pinning clock statuses through it.
