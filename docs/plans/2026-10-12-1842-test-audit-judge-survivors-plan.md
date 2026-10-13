---
title: Kill the audit judge's verdict-weakening survivors - Plan
type: test
date: 2026-10-12
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
supersedes: docs/plans/2026-10-12-1748-test-audit-judge-survivors-plan.md
---

# Kill the audit judge's verdict-weakening survivors - Plan

## Goal Capsule

- **Objective:** every mutant that survives in `packages/stryker-js/src/audit-drops.workflow.ts` on main and can change an audit verdict is killed by a property of the judge's published workflow `auditDrops`.
- **Evidence base:** main's kill matrix `kill-matrix-445` (run 38278850733, main `ddeb67ab5`). The judge's files are unchanged from `ddeb67ab5` to the branch base, so its mutant ids still apply.
- **Authority:** tests only. No judge logic changes unless a new law exposes a real bug, which would make it a product fix that the PR names as one.
- **Stop:** the PR off main is green on its head and its body maps each targeted mutant id to the law and region that kills it.
- **Packs:** `schema-laws` (`tests-own-no-schemas`, `arbitrary-filter-floors`), `cell-architecture` (`pure-decision-workflows`: the subject is the existing Workflow, called directly). `boundary-testing` does not apply: the judge does no I/O.

---

## Product Contract

### Summary

Add two properties to `packages/stryker-js/src/__tests__/audit-drops.workflow.property.test.ts`. One pins when a pair joins the matrix; the other pins when the audit fails. Every draw of each law carries one input per distinguishing region, so the mutation lane's 30 draws reach every region on every draw.

### Problem Frame

The drop audit is the evidence that subsumption loses no kill signal, so a judge that can be weakened without a red test certifies nothing. `kill-matrix-445` records 28 survivors in `audit-drops.workflow.ts`. Nineteen are `StringLiteral` mutants on next-action text, which change no verdict. Nine are not:

| Mutant             | Line | Mutation                           | Effect on the report                                                                                                                         |
| ------------------ | ---- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `f827a40bbc33285f` | 162  | `settledOr` condition to `true`    | A settled pair under a Survived or not-run dominator becomes `Unjoinable(status-unsettled)`, so `Fail(dominator-not-run)` disappears         |
| `10f13d57305aca67` | 162  | `settledOr` condition to `false`   | A Pending mutant under a Survived dominator joins as `Vacuous`, so a rule whose only pair is Pending counts as Attested and the audit passes |
| `ef7232acbfa22904` | 162  | `===` to `!==`                     | Both of the above                                                                                                                            |
| `ecf4bad10208f251` | 269  | `isUnattested` returns `undefined` | Unattested rules never fail the audit                                                                                                        |
| `ed8fb94747c4a35b` | 270  | `Unattested: () => false`          | Same as above                                                                                                                                |
| `37d514a77be2c587` | 338  | first `+` to `-`                   | One unattested rule plus one orphaned test sums to 0, so the audit passes                                                                    |
| `47fe116e037a0823` | 270  | `Attested: () => true`             | Every rule counts as unattested, so a clean audit fails                                                                                      |
| `cf6bc19ff53fc970` | 338  | condition to `false`               | The audit always fails                                                                                                                       |
| `d423fd2610a22d69` | 227  | `pairOrder` to `[]`                | Pairs keep insertion order; no verdict or count changes                                                                                      |

The first six weaken a verdict. The next two flip a pass to a fail; the law that kills the line 269, 270 and 338 weakenings kills them too. The last changes only report order.

The laws already state most of these universals. They fail to kill because of sampling. Mutation workers run each law 30 times (`packages/toolchain/vitest-config/lib/property-runs.js`), passed to every `it.prop` through `test.provide`, and `@systemfsoftware/vitest` derives each law's seed from seed 1 and the law's identity. Line 162's mutants are covered only by laws 585, 588 and 589, which constrain Killed-dominator outcomes. Law 587 (`ShouldLeaveTheRuleUnattestedWhenThePairDoesNotJoin`) would distinguish them, but the matrix records that its lane draws never reach line 162. Its shared generator gives the reaching shape (both records present, dominator `Survived` or not run) about 9/64 of draws, so whether a law's 30 draws reach it depends on that law's seed. No law asserts the audit's pass/fail tag against unattested rules or orphans, only against Fail pairs (law 588). The integration test that would catch lines 269 and 270 (`packages/stryker-js/tests/audit.integration.test.ts:237`) is outside the mutation run.

### Requirements

**Joining**

- R1. A law states that a pair whose dropped mutant and dominator are both in the matrix joins exactly when neither status is `Pending`, and is otherwise `Unjoinable` with reason `status-unsettled`.
- R2. Every draw of R1's law includes a dominator in `Survived`, `CompileError`, `RuntimeError` or `Ignored` with a Pending mutant, and the same with a settled mutant.

**Audit verdict**

- R3. A law states that the report is `DropAuditFailed` exactly when some pair's verdict is `Fail`, some rule is `Unattested`, or some test is orphaned.
- R4. Every draw of R3's law includes a clean audit, an unattested rule with no orphan, an unattested rule with an orphan and no `Fail` pair, and a `Fail` pair with no other failure. Each of these asserts the outcome its inputs imply.

**Evidence**

- R5. The PR body names each targeted mutant id, the law and region that reach it, and the next kill matrix on main as the proof.

### Scope Boundaries

- The 19 `StringLiteral` survivors change only next-action text, and `d423fd2610a22d69` changes only pair order. Neither can weaken a verdict, so this unit leaves them surviving. They remain CONST-T3 debt on the file's mutated set, which belongs to the root (session-settled: user-directed — chosen over killing every survivor in the file: a mutant that changes only next-action or message text does not count).
- Survivors in `packages/stryker-js/src/audit.schema.ts` and `audit-request.cell.ts` are outside this unit, which covers `audit-drops.workflow.ts` only.
- No change to `property-runs.js`, the mutation config, or `ci.yml`. These are judging surfaces (CONST-E9).
- Existing laws 583 to 589 stay as they are. Sharpening their shared generator could cost kills they hold today, which only a mutation run would show.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Sharper properties, not examples.** CONST-T3 says to kill a survivor "with a sharper property", and CONST-T14 rules out hand-picked example tests for the core. Each region input is generated: killers, statuses and the unconstrained pair all come from production schemas. Exhaustive status tables are rejected: they would copy the judge's own dispatch into the test (CONST-T10).
- KTD2. **Reach is structural.** Each draw is a tuple with one input per region plus one unconstrained input, checked by an explicit conjunction. The lane's 30 draws therefore reach every region 30 times, and the first draw kills any targeted mutant. A `cover` class would not do this: `@systemfsoftware/vitest` judges classes over extra predicate-only draws, so a class passes even when a law's executed draws miss it.
- KTD3. **Two oracles per law.** A region input asserts the outcome its defining facts imply, an oracle drawn from the judge's documented verdict semantics. The unconstrained input asserts the relation between the report's tag and its own pairs, rules and orphaned tests, which is intrinsic redundancy (CONST-T10). A constant-output subject therefore fails the region conjuncts even though it would satisfy the relation.
- KTD4. **Regions are built constructively.** The settled and unkilled status sets are `pick`s of `Mutant.MutantStatusSchema`, the failing pair's mutant status is `Mutant.SurvivorStatusSchema`, and killers are the file's named tests. Nothing is filtered (`arbitrary-filter-floors`), and the test declares no schema of its own (`tests-own-no-schemas`).
- KTD5. **The kill proof is main's next kill matrix**, because mutation runs only in CI on main.

---

## Implementation Units

### U1. Pair-join law

- **Goal:** R1 and R2.
- **Files:** `packages/stryker-js/src/__tests__/audit-drops.workflow.property.test.ts`.
- **Approach:** draw a pending element and a settled element under an unkilled dominator, plus one unconstrained pair, per KTD2. The pending element is `Unjoinable(status-unsettled)`, the settled element joins, and the unconstrained pair joins exactly when neither status is `Pending`.
- **Test scenarios:**
  - A dominator `Survived` with a mutant `Killed` joins with verdict `Vacuous(dominator-survived)`. Kills `f827a40bbc33285f` and `ef7232acbfa22904`.
  - A dominator `CompileError` with a mutant `Pending` is `Unjoinable(status-unsettled)`. Kills `10f13d57305aca67` and `ef7232acbfa22904`.
  - A dominator `Killed` with a mutant `Pending` is `Unjoinable`. This path does not go through `settledOr`; the unconstrained pair pins the same universal.
- **Verification:** the law passes at the default budget and at the worker budget.

### U2. Audit-verdict law

- **Goal:** R3 and R4.
- **Files:** same file as U1.
- **Approach:** draw a clean element, an unattested element, an orphaned element and a failing-pair element, plus one unconstrained pair, per KTD2 and KTD3. The clean element passes, the other three fail, and the unconstrained pair's tag matches its own pairs, rules and orphaned tests.
- **Test scenarios:**
  - The dominator and the mutant are Killed by the same named test: `DropAuditPassed`. Kills `47fe116e037a0823` and `cf6bc19ff53fc970`.
  - The dominator is absent and no named test kills the mutant: `DropAuditFailed`, from an unattested rule only. Kills `ecf4bad10208f251` and `ed8fb94747c4a35b`.
  - The dominator is absent and a named test kills only the dropped mutant: `DropAuditFailed`, with one unattested rule, one orphan and no `Fail` pair. Kills `37d514a77be2c587`.
  - The dominator is Killed by a named test and the mutant survives: `DropAuditFailed`, from a `Fail` pair only.
- **Verification:** as U1.

---

## Verification Contract

| Check                     | Command or source                                                                                               | Done signal                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Laws at default budget    | `pnpm --filter @systemfsoftware/stryker-js exec vitest run src/__tests__/audit-drops.workflow.property.test.ts` | exit 0                                                                                           |
| Laws at the worker budget | the same command with `STRYKER_WORKER_DIR` set, which selects 30 runs and the seed-1 derivation                 | exit 0                                                                                           |
| Typecheck, lint, format   | the package's `typecheck`, `lint` and `lint:tsgo` scripts, `./bin/dprint check`                                 | exit 0                                                                                           |
| Review                    | `ce-code-review mode:agent base:origin/main`, report-only, with the cross-model pass when a peer route exists   | every finding has a recorded disposition                                                         |
| CI                        | `xd://github run_watch` on the PR head                                                                          | all required jobs green                                                                          |
| Kill proof                | the next `kill-matrix-<n>` on main after merge                                                                  | the eight ids in U1 and U2 are `Killed`; any survivor is reported to the root with its matrix id |

## Definition of Done

- U1 and U2 have landed in one PR off main, with a changeset if the Changeset Check requires one.
- Every row of the Verification Contract up to CI holds on the PR head.
- The PR body cites `kill-matrix-445`, maps each id to its law and region (R5), and leaves the kill proof to main's next matrix.
