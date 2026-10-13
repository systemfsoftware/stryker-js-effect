---
title: Timeout Needs Nontermination Evidence - Plan
type: fix
date: 2026-10-13
topic: timeout-needs-evidence
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Timeout Needs Nontermination Evidence - Plan

## Goal Capsule

- **Objective:** a stryker-js-effect report scores a mutant as a detected Timeout only when the run holds evidence that the mutant does not terminate, so a slow survivor is reported as a survivor.
- **Means:** an unconfirmed wall-clock expiry is re-run once, in the same run, before it is scored. A hit-limit breach needs no confirmation.
- **Product authority:** the root's 2026-10-13 intent ("runaway-mutant safety: hit limits plus infinite-loop detection"), narrowed by the measurement in the Problem Frame, then `CONSTITUTION.md`. The root's premise that the project lacks hit limits does not hold on `main` (Q1).
- **Open blockers:** Q1 and Q2 (root). No unit starts before the root accepts this contract.
- **Applicable packs** (`.compound-engineering/config.yaml`): `cell-architecture`, `boundary-testing`, `schema-laws`.

## Product Contract

### Summary

A mutant whose run expires the wall-clock deadline gets one confirmation run in the same mutation run. It is reported Timeout only if the confirmation expires too; otherwise the confirmation's verdict is reported. Termination safety, the hit limit and worker replacement stay as they are.

### Problem Frame

**Runaway termination already ships at StrykerJS parity.** On `main` (`b4db6d8ed`):

| Mechanism                                                               | `main`                                                                                                                                         | StrykerJS 10.0.0                                                  | mutmut 3.8.0                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Hit limit in the activation helper, thrown when `++hitCount > hitLimit` | `packages/stryker-js-instrumenter/src/InstrumentHeader.ts:65-78`                                                                               | `packages/instrumenter/src/util/syntax-helpers.ts:59-70`          | none                                          |
| Limit = dry-run hit count x 100, only when a hit count exists           | `packages/stryker-js/src/plan-mutant-tests.workflow.ts:94-101`, `:190-193`                                                                     | `packages/core/src/mutants/mutant-test-planner.ts:36`, `:196-199` | none                                          |
| Breach reported as Timeout `Hit limit reached (n/limit)`                | `packages/stryker-js-vitest-runner/src/interpret-vitest-mutant-run.workflow.ts:10-11`, `:138-146`                                              | `packages/api/src/test-runner/run-result-helpers.ts:8-19`         | none                                          |
| Wall-clock deadline `timeoutFactor x net + timeoutMS + overhead`        | `plan-mutant-tests.workflow.ts:140-162`; defaults 1.5 and 5000 at `packages/stryker-js-plugin-interface/src/stryker-options.schema.ts:279-280` | same formula and defaults                                         | `(tests + 1.0) x 15.0` wall plus `RLIMIT_CPU` |
| Hung worker killed and replaced, run continues                          | `packages/stryker-js/src/pooled-test-runner.handle.ts:55-112`, `:156-161`; `run/mutant-run.ts:278-281`                                         | `TimeoutDecorator` restarts the runner                            | fork per mutant, `SIGXCPU` then `SIGKILL`     |

mutmut has no loop detection; StrykerJS's "infinite loop prevention" is the hit limit above. Tests exist on `main`: `packages/stryker-js/tests/wall-clock-timeout.integration.test.ts`, `packages/stryker-js-vitest-runner/testResources/infinite-loop/`, and the hit-limit reason property in `packages/stryker-js-vitest-runner/src/__tests__/interpret-vitest-mutant-run.workflow.property.test.ts`.

**What fails is the verdict.** A wall-clock expiry is scored as a detected Timeout (`packages/stryker-js/src/Reporter/render-progress-report.workflow.ts:96`) with no evidence that the mutant would not finish. Main's own Mutation runs at one commit show the cost:

- Push run [38378246563](https://github.com/systemfsoftware/stryker-js-effect/actions/runs/38378246563) (#468, `3797debd6`, `mutation-report-468`) reports 24 Timeouts, all `wall-clock-timeout`, all in `packages/stryker-js-typescript-checker`.
- The scheduled run [38384850859](https://github.com/systemfsoftware/stryker-js-effect/actions/runs/38384850859) (#469) at the same commit, over the same 10,277 mutants, reports 20 of those 24 as Survived, 3 Killed and 1 Timeout. Both runs executed every mutant: no verdict in either report is `remembered`, and the schedule passes `--full` (`.github/workflows/mutation.yml:85`).
- So #468 credits 20 survivors as detected: 1,362 detected against #469's 1,342, score 51.85% against 51.08%.
- The 24 are slow, not runaway. In #468's checker record, completed survivors ran at up to 1.53x their predicted cost (p90 1.42x); the 24 Timeouts sit at a median of 1.56x and a maximum of 1.73x, the tail of the same distribution cut by the deadline. They took 871 s of the project's 2,365 s of mutant time.
- The hit limit fired 0 times in `mutation-report-465`, `mutation-report-468`, `mutation-report-469` and `kill-matrix-468`. Every Timeout on the corpus is a wall-clock expiry.

The incremental record already distrusts these verdicts: an unreproduced wall-clock Timeout is refused reuse and re-run next time (`packages/stryker-js/src/incremental-diff.workflow.ts:86-101`, refusal `timeoutUnreproduced`). The report of the run that produced it still scores it.

### Key Decisions

- **The unit fixes the Timeout verdict, not termination.** Termination ships (Problem Frame); the measured defect is 20 survivors scored as detected at one commit. Governs R2, R3.
- **Confirm in the same run, under a larger deadline.** Re-running under the same deadline does not separate slow from runaway: in #469, `f3fd369e0d507988` expired again at 1.53x its predicted cost and `85e7dc436a591f9f` finished at 1.44x, while #468's survivors reach 1.53x. The confirmation's deadline must clear that tail. Governs R3.
- **A hit-limit breach is evidence on its own.** It is a deterministic count over the mutant's own activations. Governs R4.
- **No new loop instrumentation.** The hit limit fired 0 times across four main artifacts, so back-edge counters have no corpus demand. See Scope Boundaries.
- **No new wire field, and `statusReason` keeps its meaning.** For Killed and RuntimeError, `statusReason` is the failure or error message (`packages/stryker-js/src/mutation-reporting.service.ts:1070-1081`), and the clear-text report prints it as "Error message" for RuntimeError (`packages/stryker-js/src/Reporter/render-clear-text-report.workflow.ts:370-381`), so it cannot carry a first-expiry note. The record's existing `reproductions` carries the confirmation. Governs R5, R6. Respects the root's Q6 ruling against presence-by-reason fields (pack: schema-laws, tagged-unions-over-state-by-presence.md).

### Requirements

**Termination (kept as is)**

- R1. Every mutant run ends by its tests, by the hit limit, or by the wall-clock deadline, and a hung worker is replaced while the run continues. This is `main`'s behaviour, read from code (Problem Frame table), and the unit must not weaken it.

**Timeout verdict**

- R2. A report scores a mutant as Timeout only with nontermination evidence: a hit-limit breach (R4) or a confirmed wall-clock expiry (R3).
- R3. A wall-clock expiry gets exactly one confirmation run of that mutant in the same mutation run, on a fresh worker, under a deadline at least twice the first one.
- R4. A hit-limit breach is reported Timeout with its `Hit limit reached (n/limit)` reason and no confirmation run.
- R5. A confirmation that expires again yields Timeout with reason `wall-clock-timeout`, and the run itself records it as reproduced (`reproductions` 1), so the next run reuses it. Today only a previous run's record supplies that evidence (`packages/stryker-js/src/incremental-diff.workflow.ts:275-289`, `packages/stryker-js/src/run/incremental-reuse.cell.ts:425-429`), so a first expiry stays at 0 and is re-run on every push.
- R6. A confirmation that finishes yields its verdict exactly as an ordinary run would (Killed, Survived, RuntimeError, with the usual `statusReason`), and the score counts it accordingly.
- R7. The kill-matrix lane (`STRYKER_KILL_MATRIX=1`, every killer kept) runs confirmations too, so a confirmed kill records its killers. `stryker audit` keys its predicates on `status` and `killedBy` only (`packages/stryker-js/src/audit-drops.workflow.ts`), so no audit change follows.

**Evidence**

- R8. Tests: decision rules (when to confirm, the confirmation deadline, how its outcome maps to the verdict and to `reproductions`) are pure workflows with property tests. One engine integration test, beside `wall-clock-timeout.integration.test.ts`, drives the published run surface with a fixture that expires on its first attempt and finishes within the confirmation deadline (R6), and the existing never-settling fixture now asserts a confirmed Timeout with `reproductions` 1 (R5).
- R9. Before and after counts come only from main's Mutation runs, cited by run id (no local mutation run). Before is #468 against #469 at `3797debd6`. After is the first push run on `main` after release, against the scheduled run at the same commit: the number of reported Timeouts, their reasons, how many of them the scheduled run reports Survived, and the checker project's `budget.actualSeconds`.

### Acceptance Examples

- AE1. **Covers R3, R6.** In #468, mutant `141d93c9edf79341` (`CheckerCommands.schema.ts:20`, ObjectLiteral) expires and is reported Timeout; #469 runs it at 0.87x its predicted cost and reports it Survived. Under this contract its confirmation finishes inside the doubled deadline and the report shows Survived.
- AE2. **Covers R3, R5.** `f3fd369e0d507988` (`override-tsconfig-options.workflow.ts:35`, ObjectLiteral) expires in #468 and again in #469 at 1.53x. Under this contract its confirmation runs with a deadline at least twice the first: if it finishes, the report shows its test verdict; if it expires again, it is a confirmed Timeout with `reproductions` 1.
- AE3. **Covers R5.** The never-settling promise mutant of `wall-clock-timeout.integration.test.ts` expires, its confirmation expires, and it is reported Timeout `wall-clock-timeout` with `reproductions: 1`; a second run reuses the verdict without running the mutant.
- AE4. **Covers R4.** A `while` mutant in `testResources/infinite-loop` breaches its hit limit and is reported Timeout `Hit limit reached (n/limit)` after one run.
- AE5. **Covers R7.** In a kill-matrix run, a mutant whose first run expires and whose confirmation is killed by two tests records both killers.

### Success Criteria

- No report on `main` scores a wall-clock Timeout whose record lacks `reproductions` 1 (mechanical, from the report and the record).
- At the after commit, the count of reported Timeouts that the scheduled run reports Survived is published next to the baseline of 20 (R9).
- The checker project's mutant time rises by at most the confirmation runs' cost, and confirmed Timeouts are reused on the next push instead of re-run.

### Scope Boundaries

- Out: marking a confirmation's verdict as "expired once" in the report. There is no channel for it without a new field (Key Decisions); revisit if a reader needs it.
- Out: loop or recursion back-edge counters beyond the hit limit. Zero hit-limit firings on the corpus; revisit when a main run shows a runaway the hit limit missed.
- Out: per-test progress events on the runner stream. `MutantRunEventSchema` carries only `MutantRunStarted` and `MutantRunSettled` (`packages/stryker-js-plugin-interface/src/TestRunner.schema.ts:57-81`); adding one is a plugin wire change and does not fix the verdict.
- Out: changing the `timeoutFactor` or `timeoutMS` defaults. A larger factor moves the cut-off for every mutant and still scores unconfirmed expiries.
- Out: CPU-time limits per worker and a whole-run watchdog. No main run shows a run that failed to end.
- Out: diagnosing why checker tests run slower under mutation than in the dry run. That is a cost question for its own unit; this unit only stops it from inflating the score.
- Out: hot reload. It changes how fast an environment resets, not whether a runaway ends or how it is scored.

### Dependencies / Assumptions

- The vitest runner is the only test-runner plugin (`packages/stryker-js-vitest-runner`), so R3's fresh worker is the existing pool replacement.
- Mutant ids are content-addressed, so #468 and #469 compare the same mutants (both list 10,277).

### Outstanding Questions

**Resolve Before Planning**

- Q1. **Accept the reframe (root).** The root asked for hit limits and infinite-loop detection that the project "lacks". `main` ships both mechanisms at StrykerJS parity (Problem Frame table), and mutmut has no loop detection. The measured defect is the Timeout verdict. Two runaway classes have no main-run evidence either way: a spin in unmutated code after one activation (the hit limit cannot see it; the wall-clock deadline ends it) and a test that leaves a child process running after its worker is replaced. Accept this contract, or name a runaway `main` fails to end, with a run id.
- Q2. **Pay for confirmation, or reuse the record (root).** Option a, this contract: one in-run confirmation per expiry under a doubled deadline. It costs up to twice each expiry's first deadline; #468's 24 expiries took 871 s. Option b, zero run cost: score a wall-clock Timeout as detected only when the record already shows a prior expiry (`reproductions` 1, `incremental-diff.workflow.ts:86-101`), so the second consecutive expiry confirms it. Option b reports a first expiry as Timeout but does not count it as detected, so the Timeout status stops meaning "detected" on its own, and a run with no prior record (first run, cache miss) confirms nothing. Recommended: a.

**Deferred to Planning**

- Q3. Changeset classification: reported statuses change (#468's score would drop by about 0.76 points). BREAK-1 in `AGENTS.md` says a break bumps `major`.
- Q4. When confirmations run (as each expiry happens, or after the shard's other mutants settle), the exact deadline factor at or above 2, and how their cost is attributed in `costs` and `budget`.
