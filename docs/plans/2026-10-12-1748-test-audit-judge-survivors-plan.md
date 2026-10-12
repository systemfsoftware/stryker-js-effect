---
title: Kill the audit judge's verdict-weakening survivors - Plan
type: test
date: 2026-10-12
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Kill the audit judge's verdict-weakening survivors - Plan

## Goal Capsule

- **Objective:** every mutant that survives in `packages/stryker-js/src/audit-drops.workflow.ts` on main and can change an audit verdict is killed by a property of the judge's published workflow `auditDrops`.
- **Evidence base:** main's kill matrix `kill-matrix-445` (run 38278850733, main `ddeb67ab5`). The judge's files are unchanged from `ddeb67ab5` to `ce66cd7a7`, so its mutant ids still apply.
- **Authority:** tests only. No judge logic changes unless a new law exposes a real bug, which would make it a product fix that the PR names as one.
- **Stop:** the PR off main is green on its head and its body maps each targeted mutant id to the law that kills it.
- **Packs:** `schema-laws` (`tests-own-no-schemas`, `arbitrary-filter-floors`), `cell-architecture` (`pure-decision-workflows`: the subject is the existing Workflow, called directly). `boundary-testing` does not apply: the judge does no I/O.

---

## Product Contract

### Summary

Add two properties to `packages/stryker-js/src/__tests__/audit-drops.workflow.property.test.ts`. One pins when a pair joins the matrix. The other pins when the audit fails. Each property gets a generator that reaches its distinguishing inputs within the mutation lane's own budget.

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
- R2. R1's law declares two coverage classes: a dominator in `Survived`, `CompileError`, `RuntimeError` or `Ignored` with a Pending mutant, and the same with a settled mutant. Each class holds at least a quarter of the generator's draws.

**Audit verdict**

- R3. A law states that the report is `DropAuditFailed` exactly when some pair's verdict is `Fail`, some rule is `Unattested`, or some test is orphaned. The law reads all three from the report itself.
- R4. R3's law declares three coverage classes, each holding at least a quarter of the generator's draws: a clean audit, an unattested rule with no orphan, and an unattested rule with an orphan and no `Fail` pair.

**Evidence**

- R5. The PR body names each targeted mutant id, the law and coverage class that reach it, and the next kill matrix on main as the proof.

### Scope Boundaries

- The 19 `StringLiteral` survivors change only next-action text, and `d423fd2610a22d69` changes only pair order. Neither can weaken a verdict, so this unit leaves them surviving. They remain CONST-T3 debt on the file's mutated set, which belongs to the root (session-settled: user-directed — chosen over killing every survivor in the file: a mutant that changes only next-action or message text does not count).
- Survivors in `packages/stryker-js/src/audit.schema.ts` and `audit-request.cell.ts` are outside this unit, which covers `audit-drops.workflow.ts` only.
- No change to `property-runs.js`, the mutation config, or `ci.yml`. These are judging surfaces (CONST-E9).
- Existing laws 583 to 589 stay as they are. Sharpening their shared generator could cost kills they hold today, which only a mutation run would show.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Sharper properties, not examples.** CONST-T3 says to kill a survivor "with a sharper property", and CONST-T14 rules out hand-picked example tests for the core. Each new law is a universal over generated input, and its generator is dense where the mutant and the original disagree. Exhaustive status tables are rejected: they would copy the judge's own dispatch into the test (CONST-T10).
- KTD2. **R1 gets its own generator.** Both records are always present, the dominator status is drawn from `Survived`, `CompileError`, `RuntimeError` or `Ignored` for half of the draws and from all of `Mutant.MutantStatusSchema` otherwise, and the mutant status is `Pending` for half of the draws. Each R2 class then holds at least a quarter of the draws. Absence stays with laws 583 and 587.
- KTD3. **R3 is relational and builds each region on purpose.** The oracle is the report's own pairs, rules and orphaned tests: two views of one value (CONST-T10). The generator picks one of four region builders with equal weight: a clean audit (dominator and mutant Killed by the same named test, nothing killed by `t1` alone), an unattested rule (dominator absent, no test kills only the dropped mutant), an unattested rule with an orphan (dominator absent, named `t1` kills only the dropped mutant), and an unconstrained pair like the existing laws draw. Every R4 class is a constructive draw, not a filtered one (`arbitrary-filter-floors`), and the unconstrained builder keeps the law universal over `Fail` pairs.
- KTD4. **Coverage classes guard the generator; share arithmetic covers the lane; main's matrix proves the kill.** Each R2 and R4 region is an `it.prop` `cover` class (`@systemfsoftware/vitest` R14) with minimum share 0.1, well under its quarter. The framework judges a class over the law's runs plus extra predicate-only draws from the same generator, so `cover` fails a generator edit that loses a region, not a lane run whose 30 draws happened to miss one. At a quarter share, a law's 30 executed draws miss a given class with probability $0.75^{30} \approx 1.8 \times 10^{-4}$. The kill proof is main's next kill matrix, because mutation runs only in CI on main. No other repo test uses `cover` yet; the shape follows the framework's declaration (`cover?: Record<label, [predicate, minimumShare]>`).
- KTD5. **Generators come from production schemas.** Statuses come from `Mutant.MutantStatusSchema`. Rule names come from `Mutant.Subsumed`'s single literal `complement`. The test declares no schema (`tests-own-no-schemas`).

---

## Implementation Units

### U1. Pair-join law

- **Goal:** R1 and R2.
- **Files:** `packages/stryker-js/src/__tests__/audit-drops.workflow.property.test.ts`.
- **Approach:** add a join-scenario generator per KTD2 and one law over `auditDrops` that compares the pair's tag (`JoinedPair`, or `UnjoinablePair` with `status-unsettled`) with whether either input status is `Pending`.
- **Test scenarios:**
  - A dominator `Survived` with a mutant `Killed` joins with verdict `Vacuous(dominator-survived)`. Kills `f827a40bbc33285f` and `ef7232acbfa22904`.
  - A dominator `CompileError` with a mutant `Pending` is `Unjoinable(status-unsettled)`. Kills `10f13d57305aca67` and `ef7232acbfa22904`.
  - A dominator `Killed` with a mutant `Pending` is `Unjoinable`. This path does not go through `settledOr`; it pins the same universal.
- **Verification:** the law and its coverage classes pass at the default budget and at the worker budget.

### U2. Audit-verdict law

- **Goal:** R3 and R4.
- **Files:** same file as U1.
- **Approach:** add an audit-scenario generator per KTD3 and one law: the report's tag is `DropAuditFailed` exactly when its pairs hold a `Fail` verdict, its rules hold an `Unattested` summary, or `orphanedTests` is non-empty.
- **Test scenarios:**
  - The dominator is Killed by `t2`, the mutant is Killed by `t2`, and `t1` kills nothing: `DropAuditPassed`. Kills `47fe116e037a0823` and `cf6bc19ff53fc970`.
  - The dominator is absent and no test is orphaned: `DropAuditFailed`, from an unattested rule only. Kills `ecf4bad10208f251` and `ed8fb94747c4a35b`.
  - The dominator is absent and the dropped mutant is Killed by named `t1` only: `DropAuditFailed`, with one unattested rule, one orphan and no `Fail` pair. Kills `37d514a77be2c587`.
- **Verification:** as U1.

---

## Verification Contract

| Check                     | Command or source                                                                                               | Done signal                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Laws at default budget    | `pnpm --filter @systemfsoftware/stryker-js exec vitest run src/__tests__/audit-drops.workflow.property.test.ts` | exit 0                                                                                                    |
| Laws at the worker budget | the same command with `STRYKER_WORKER_DIR` set, which selects 30 runs and the seed-1 derivation                 | exit 0: the laws hold on the lane's own draws, and each class's generator share clears its minimum (KTD4) |
| Typecheck, lint, format   | the package's `typecheck` and `lint` scripts, `./bin/dprint check`                                              | exit 0                                                                                                    |
| Review                    | `ce-code-review mode:agent base:origin/main`, report-only, with the cross-model pass                            | every finding has a recorded disposition                                                                  |
| CI                        | `xd://github run_watch` on the PR head                                                                          | all required jobs green                                                                                   |
| Kill proof                | the next `kill-matrix-<n>` on main after merge                                                                  | the eight ids in U1 and U2 are `Killed`; any survivor is reported to the root with its matrix id          |

## Definition of Done

- U1 and U2 have landed in one PR off main, with a changeset if the Changeset Check requires one.
- Every row of the Verification Contract up to CI holds on the PR head.
- The PR body cites `kill-matrix-445`, maps each id to its law and coverage class (R5), and leaves the kill proof to main's next matrix.
