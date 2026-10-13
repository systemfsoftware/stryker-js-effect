---
title: Turbo Boundaries Clean Tree - Plan
type: refactor
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
supersedes: docs/plans/2026-10-12-1932-refactor-turbo-native-caching-plan.md (U11 and Q3 only)
---

# Turbo Boundaries Clean Tree - Plan

## Goal Capsule

- **Objective:** `turbo boundaries` exits 0 on `main`. Each of today's 20 diagnostics is either fixed at its source or declared at its own import line with a reason a reviewer can check against a file. The graded work lands without the gate that will grade it.
- **Means:** Fix the 13 imports that do reach into another package (KTD2, KTD3). Declare the 7 imports that Turbo cannot see are declared (KTD4). Carry the gate enrollment as a request to its owner, not as a change (KTD1).
- **Product authority:** The root's Stream K follow-up of 2026-10-13 corrects the earlier Q3 intent under CONST-E7 (handle EVIDENCE-NOT-SELF-GRADING), which absorbs CONST-E9 (`systemfsoftware/systemfsoftware` 763fd663, `repos/constitution/ENFORCEMENT.md:261-271`). The law's second check (`:267-268`) requires the graded change and any judgment-surface change to name different owners. Building the gate the work will be graded by fails it, even in a separate commit by the same hands. This plan owns the graded work: the 20 diagnostics. A different session owns the `turbo boundaries` gate and authors it after U1 of the superseded plan (#319) merges, with the root as owner. Enrollment rules for that owner are at `ENFORCEMENT.md:27-32`: enroll over a clean tree, at error, with no baseline.
- **Supersession:** This plan replaces U11 and Q3 of `docs/plans/2026-10-12-1932-refactor-turbo-native-caching-plan.md`. That plan is carried by the open #319, which the root holds frozen at `08e6b4eb`, so its text is corrected here rather than in place. Its U11 put the diagnostic fixes and the `check:ci` enrollment in one unit. That is the E7 breach the root's correction names. Every other unit of that plan stands unchanged.
- **Execution profile:** One PR off `main`, independent of #319: no file in common, and no dependency on its Turbo inputs. Local verification is `turbo boundaries`, `turbo query`, lint and the touched packages' own tests. There are no local e2e or mutation runs, and no CI wiring changes.
- **Stop conditions:** Stop and report if a fix changes what a test checks; if oxlint cannot load the shared lint config through a package export (KTD3); or if the diagnostic set on `main` moves away from the 20 listed below before the PR is ready.
- **Who finishes:** CE `ce-work` implements, `ce-code-review` reviews, and the conductor opens the PR and reports its head and CI. The root merges. The gate owner then enrolls the gate from the request in the PR body.

---

## Product Contract

### Summary

Today `turbo boundaries` reports 20 diagnostics on `main` (`ec1769de`). Thirteen are real reaches into another package's files, and they get fixed through declared routes. Seven are imports Turbo misreads, and they get declared one by one. When the PR merges, the tree is clean and the gate owner can enroll the gate at error without a baseline.

### Problem Frame

Measured with `turbo query 'query { boundaries { items { message import path } } }'` on Turbo 2.10.12 at `ec1769de`:

| Site                                                                                            | Imports                                                                                 | Count | Kind               |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----- | ------------------ |
| `test/e2e-core/tests/__fixtures__/effect-concurrency/fixture-project.js:1-12`                   | `../../../../../packages/stryker-js-instrumenter/testResources/effect-concurrency/*.js` | 12    | leaves the package |
| `test/bench/oxlint.config.ts:1`                                                                 | `../e2e-core/oxlint.config.ts`                                                          | 1     | leaves the package |
| `packages/stryker-js/tests/vm-parity.differential.test.ts:5`, `vm-runner.integration.test.ts:4` | `@systemfsoftware/stryker-js-vm-runner`                                                 | 2     | not a dependency   |
| `test/e2e/scripts/export-traces.ts:3-4`, `import-traces.ts:3-5`                                 | `@std/fs`, `@std/path`, `@std/encoding`                                                 | 5     | not a dependency   |

`fixture-project.js` re-exports the instrumenter's twelve concurrency resources for one reason: so that the TypeScript project rooted in its directory takes them in. Its `tsconfig.json` has no `include`, so the program is whatever sits in that directory. `concurrency-checker.integration.test.ts:52-73` reads the same directory with the file system and asserts that every definition file is in the checker's program (`:199-207`). `test/bench/oxlint.config.ts` reaches into `test/e2e-core` to share its lint config (#274, "the bench shares the e2e-core lint config"), even though bench already declares `@systemfsoftware/stryker-e2e-core` as a dev dependency.

The other seven are false reports:

- `stryker-js` declares `"@systemfsoftware/stryker-js-vm-runner": "workspace:@systemfsoftware/stryker-js-vitest-runner@^"`. The alias gives its tests the workspace runner, while `@systemfsoftware/stryker-js-vitest-runner` stays the released tarball the dogfood rule requires. Turbo records a workspace alias as an internal edge to the target's name; the package graph shows `stryker-js -> stryker-js-vitest-runner`. Its boundaries check then matches the import against internal names only (`crates/turborepo-boundaries/src/imports.rs:34-50` at v2.10.12), so the declared alias reads as missing.
- The two trace scripts are Deno programs run as `deno run --config=scripts/deno.json`. They resolve `@std/*` through that import map (`scripts/deno.json:9-16`), which Turbo does not read.

### Requirements

**Clean tree**

- R1. `turbo boundaries` exits 0 on the PR's head. `turbo query` lists no boundaries item.
- R2. Each of the 13 real cross-package imports is gone. The reach it served goes through a route the package graph declares, or through a file the consuming package owns.
- R3. Each of the 7 false reports carries a `@boundaries-ignore` comment on the line above its import. The comment states why Turbo cannot see the declaration and names the file that holds it. Nothing broader is allowed: no `boundaries` block in any `turbo.json`, no `implicitDependencies`, and no path-pattern ignore.

**No behaviour change**

- R4. Every test that touches a changed file checks exactly what it checked before. The concurrency checker still finds all twelve definition files in its program. Bench lint applies the same rules to the same files.

**Ownership (CONST-E7)**

- R5. The PR changes no judgment surface: not `check:ci`, `package.json` scripts, any workflow, any `turbo.json`, any lint or gritlint configuration, or any threshold. Its body carries the gate enrollment as a request to the gate owner, quoting `ENFORCEMENT.md:261-271` and naming the root as owner.

### Key Decisions

- **The diagnostics are the graded work, and the gate is someone else's.** The PR fixes and declares. It does not enroll. This follows the root's correction of 2026-10-13 under CONST-E7. Governs R5.
- **Declaration is per import and checkable, never a list.** A new undeclared import fails the future gate wherever it lands. Governs R3.

### Scope Boundaries

- Changing the gate or its configuration, in any commit (R5).
- Moving the Deno trace scripts to root `scripts/`. That would also fix the five `@std` reports, but it edits `e2e.yml`, which other open PRs share, and declaring is the smaller compliant change. The gate owner may still prefer it.
- Upstream Turbo work on workspace aliases.
- Stream B's reuse suites and every e2e journey stay untouched.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The gate request is written for its owner.** The PR body has a "Gate enrollment request" section. It lists the measured diagnostic count before and after, the planted-import check the owner should observe failing, the seven declarations with the reason for each, and the enrollment constraints of `ENFORCEMENT.md:27-32`. It also asks the owner to decide whether `@boundaries-ignore` declarations are acceptable evidence, or to require a different route for the seven. The work does not depend on that answer, since the tree is clean either way.
- KTD2. **The concurrency fixture project names its files in `tsconfig.json`.** `include` lists `../../../../../packages/stryker-js-instrumenter/testResources/effect-concurrency/*.ts`, and `fixture-project.js` is deleted. The re-export file was a way of putting files into a TypeScript program; the include states that directly. The cross-package read stays a data read, the same one the test already makes through the file system. The superseded plan's U1 (#319) declares it as a `$TURBO_ROOT$` input of `stryker-e2e-core#test`. `allowJs` stays, because removing it is unrelated to this change. Rejected: twelve `@boundaries-ignore` comments, which would declare imports that only exist to work around the missing `include`.
- KTD3. **Bench takes the shared lint config through `@systemfsoftware/stryker-e2e-core`'s exports.** `test/e2e-core/package.json` gains an `"./oxlint.config"` export of `./oxlint.config.ts`, and `test/bench/oxlint.config.ts` re-exports `@systemfsoftware/stryker-e2e-core/oxlint.config`. Bench already declares that dependency, and the workspace link resolves to the real path, so Node's type stripping applies. Rejected: copying the config (two copies drift), or a new toolchain package for one config.
- KTD4. **Seven declarations, each naming its evidence.** The vm-runner reason names `packages/stryker-js/package.json` and the alias it declares. The Deno reason names `scripts/deno.json`, the import map the script's shebang loads. Each comment sits directly above its import, which is the only placement Turbo reads (`crates/turborepo-boundaries/src/lib.rs:415-445`), and Turbo refuses a comment with no reason (`imports.rs:184-192`).

### Assumptions

- The oxlint 1.x loader imports a `.ts` config through a package export. It is verified in U2; failing that is a stop condition.
- With an explicit `include`, the checker's program holds the twelve definition files as root files instead of through re-exports, and the test's assertion covers exactly that.

### Test Admission

| Candidate                                                   | Verdict | Reason                                                                                                                                |
| ----------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A test asserting `turbo boundaries` exits 0                 | Refused | That is the gate. Under CONST-E7 it belongs to the gate owner (KTD1).                                                                 |
| A test that the fixture `tsconfig.json` lists the resources | Refused | It would re-pin a source text. The existing concurrency-checker scenario already checks that every definition file is in the program. |
| A test for the `@boundaries-ignore` comments                | Refused | They are comments. Removing one makes `turbo boundaries` report that import again, which the gate owner's enrollment observes.        |

### Assumptions This Plan Could Break

- The gate owner may refuse author-supplied `@boundaries-ignore` comments as evidence (`ENFORCEMENT.md:17`: "never on a field the graded work's author supplied"). Then the seven need other routes: the trace scripts move to root `scripts/`, and the vm-runner alias waits on Turbo. KTD1 asks the owner to decide. This PR's tree is clean under either answer.
- An `include` that points outside the tsconfig's directory changes the checker's `rootDir` inference. That matters only for emit, and the project sets `noEmit`.

---

## Implementation Units

### U1. Fixture project names its files

- **Goal:** Remove the 12 "leaves the package" reports from `fixture-project.js`.
- **Requirements:** R2, R4.
- **Files:** `test/e2e-core/tests/__fixtures__/effect-concurrency/tsconfig.json`, `test/e2e-core/tests/__fixtures__/effect-concurrency/fixture-project.js` (deleted).
- **Approach:** KTD2.
- **Test scenarios:** None new. The existing `concurrency-checker.integration.test.ts` scenario "the start reports nothing and every definition file is in the program" proves the program is unchanged, and the mutant-count scenario proves the checker still sees every mutant.
- **Verification:** `pnpm exec turbo run test --filter=@systemfsoftware/stryker-e2e-core -- tests/concurrency-checker.integration.test.ts` passes. `turbo query` lists none of the twelve.

### U2. Bench lint config through the declared package

- **Goal:** Remove the bench report.
- **Requirements:** R2, R4.
- **Files:** `test/e2e-core/package.json`, `test/bench/oxlint.config.ts`.
- **Approach:** KTD3.
- **Test scenarios:** None new. Bench lint before and after reports the same result over the same files.
- **Verification:** `pnpm exec turbo run lint --filter=@systemfsoftware/stryker-bench` passes. Planting one `process.exit()` in a bench `src/` file makes it fail with the same rule as before (scratch only, reverted).

### U3. Declare the seven false reports

- **Goal:** Make the remaining seven reports visible declarations.
- **Requirements:** R3.
- **Files:** `packages/stryker-js/tests/vm-parity.differential.test.ts`, `packages/stryker-js/tests/vm-runner.integration.test.ts`, `test/e2e/scripts/export-traces.ts`, `test/e2e/scripts/import-traces.ts`.
- **Approach:** KTD4.
- **Test scenarios:** None. These are comments only.
- **Verification:** `turbo boundaries` exits 0. Removing any one declaration brings back its diagnostic. `deno check --config=scripts/deno.json` passes on both scripts.

---

## Verification Contract

| Check                    | Command                                                                                          | Done when                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Clean tree               | `pnpm exec turbo boundaries`                                                                     | exit 0                                       |
| Nothing listed           | `pnpm exec turbo query 'query { boundaries { items { import } } }'`                              | `items` is empty                             |
| Gate catches a new reach | scratch commit adding `import '../e2e-core/src/mod.ts'` to a bench file, then `turbo boundaries` | exit 1 naming that import; commit dropped    |
| Fixture program          | U1's test                                                                                        | passes                                       |
| Bench lint               | U2's lint                                                                                        | passes; the planted violation still fails it |
| Format                   | `./bin/dprint check` on changed files                                                            | exit 0                                       |
| CI                       | the PR's `check`                                                                                 | green, apart from failures known on `main`   |

## Definition of Done

- R1-R5 hold on the PR head. The PR body carries the gate enrollment request (KTD1) and the CONST-E7 ownership statement.
- No judgment-surface file appears in the diff (R5): `git diff --name-only origin/main...HEAD` lists only U1-U3's files and this plan.
- No scratch probe remains in the diff.
