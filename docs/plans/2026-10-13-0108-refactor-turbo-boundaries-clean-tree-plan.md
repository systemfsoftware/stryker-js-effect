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

- **Objective:** Clear 19 of today's 20 `turbo boundaries` diagnostics without touching any judgment surface. Each is either fixed at its source or declared at its own import line with a reason that names a file. The twentieth is in bench's lint configuration, which this work may not edit, so it goes to that file's owner as a proposal. The graded work lands without the gate that will grade it.
- **Means:** Fix the 12 imports in the concurrency fixture project (KTD2). Declare the 7 imports that Turbo misreads as undeclared (KTD4). Send the bench lint-config fix and the gate enrollment to their owners as requests, not changes (KTD1, KTD3).
- **Product authority:** The root's Stream K follow-up of 2026-10-13 corrects the earlier Q3 intent under CONST-E7 (handle EVIDENCE-NOT-SELF-GRADING), which absorbs CONST-E9 (`systemfsoftware/systemfsoftware` 763fd663, `repos/constitution/ENFORCEMENT.md:261-271`). The law's second check (`:267-268`) makes "lint configs, rule lists, thresholds, baselines, CI checks, validator scripts" read-only to the work they grade, "whether or not the maker believes they grade this task". This plan owns the graded work. A different session owns the `turbo boundaries` gate and authors it after U1 of the superseded plan (#319) merges, with the root as owner. Enrollment rules for that owner are at `ENFORCEMENT.md:27-32`: enroll over a clean tree, at error, with no baseline. The same follow-up says to derive the smallest compliant unit and report any diagnostic outside it, which is what happens to the bench diagnostic.
- **Supersession:** This plan replaces U11 and Q3 of `docs/plans/2026-10-12-1932-refactor-turbo-native-caching-plan.md`. That plan is carried by the open #319, which the root holds frozen at `08e6b4eb`, so its text is corrected here rather than in place. Its U11 put the diagnostic fixes and the `check:ci` enrollment in one unit. That is the E7 breach the root's correction names. Every other unit of that plan stands unchanged.
- **Execution profile:** One PR off `main` with no file in common with #319. KTD2 keeps a data read that #319 declares as a Turbo input. Until #319 merges, `stryker-e2e-core#test` misses those files in its hash, as it does on `main` today. Local verification is `turbo boundaries`, `turbo query`, `deno check` and the touched package's own test. There are no local e2e or mutation runs, and no CI wiring changes.
- **Stop conditions:** Stop and report if a fix changes what a test checks, if a fix needs a judgment-surface edit, or if the diagnostic set on `main` moves away from the 20 listed below before the PR is ready.
- **Who finishes:** CE `ce-work` implements, `ce-code-review` reviews, and the conductor opens the PR and reports its head and CI. The root merges. The bench config's owner and the gate owner act on the requests in the PR body.

---

## Product Contract

### Summary

Today `turbo boundaries` reports 20 diagnostics on `main` (`ec1769de`). Twelve are imports from a fixture file into another package's resources, and they are removed. Seven are imports Turbo misreads, and each is declared on its own line. The last is in bench's lint configuration. That file is a judgment surface under CONST-E7, so its fix is proposed to its owner. Once the owner applies it, the tree is clean and the gate owner can enroll the gate at error without a baseline.

### Problem Frame

Measured with `turbo query 'query { boundaries { items { message import path } } }'` on Turbo 2.10.12 at `ec1769de`:

| Site                                                                                            | Imports                                                                                 | Count | Kind               |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----- | ------------------ |
| `test/e2e-core/tests/__fixtures__/effect-concurrency/fixture-project.js:1-12`                   | `../../../../../packages/stryker-js-instrumenter/testResources/effect-concurrency/*.js` | 12    | leaves the package |
| `test/bench/oxlint.config.ts:1`                                                                 | `../e2e-core/oxlint.config.ts`                                                          | 1     | leaves the package |
| `packages/stryker-js/tests/vm-parity.differential.test.ts:5`, `vm-runner.integration.test.ts:4` | `@systemfsoftware/stryker-js-vm-runner`                                                 | 2     | not a dependency   |
| `test/e2e/scripts/export-traces.ts:3-4`, `import-traces.ts:3-5`                                 | `@std/fs`, `@std/path`, `@std/encoding`                                                 | 5     | not a dependency   |

`fixture-project.js` re-exports the instrumenter's twelve concurrency resources so that the TypeScript project in its directory takes them in. Its `tsconfig.json` has no `include`, so the program is whatever sits in that directory. `concurrency-checker.integration.test.ts:52-73` reads the same resources through the file system and asserts that every definition file is in the checker's program (`:199-207`). `test/bench/oxlint.config.ts` reaches into `test/e2e-core` to share its lint config (#274), even though bench already declares `@systemfsoftware/stryker-e2e-core` as a dev dependency.

The other seven are false reports:

- `stryker-js` declares `"@systemfsoftware/stryker-js-vm-runner": "workspace:@systemfsoftware/stryker-js-vitest-runner@^"`. The alias gives its tests the workspace runner, while `@systemfsoftware/stryker-js-vitest-runner` stays the released tarball the dogfood rule requires. Turbo records a workspace alias as an internal edge to the target's name; the package graph shows `stryker-js -> stryker-js-vitest-runner`. Its boundaries check then matches the import against internal names only (`crates/turborepo-boundaries/src/imports.rs:34-50` at v2.10.12), so the declared alias reads as missing.
- The two trace scripts are Deno programs run as `deno run --config=scripts/deno.json`. They resolve `@std/*` through that import map (`scripts/deno.json:9-16`), which Turbo does not read.

### Requirements

**Graded work**

- R1. On the PR's head, `turbo boundaries` reports exactly one diagnostic: the import at `test/bench/oxlint.config.ts:1`.
- R2. The 12 fixture imports are gone. The files they pulled in reach the program through the fixture's own `tsconfig.json` as a data read, the same read the test already makes. `turbo boundaries` audits import specifiers only, so it cannot see this read. The Turbo input that declares it belongs to #319.
- R3. Each of the 7 false reports carries a `@boundaries-ignore` comment on the line above its import. The comment states why Turbo cannot see the declaration and names the file that holds it. Nothing broader is allowed: no `boundaries` block in any `turbo.json`, no `implicitDependencies`, and no path-pattern ignore.

**No behaviour change**

- R4. Every test that touches a changed file checks exactly what it checked before. The concurrency checker still finds all twelve definition files in its program, and its program holds the same files as before apart from the deleted re-export file.

**Ownership (CONST-E7)**

- R5. The PR changes no judgment surface: not `check:ci`, `package.json` scripts, any workflow, any `turbo.json`, any lint or gritlint configuration (`test/bench/oxlint.config.ts` included), or any threshold. Its body carries two requests: the bench fix to that config's owner, and the gate enrollment to the gate owner. Both quote `ENFORCEMENT.md:261-271` and name the root as owner.

### Key Decisions

- **The diagnostics are the graded work, and the gate and lint configs belong to someone else.** The PR fixes and declares. It does not enroll the gate, and it does not edit the lint config that holds the twentieth diagnostic. This follows the root's correction of 2026-10-13 under CONST-E7. Governs R1, R5.
- **Declaration is per import and names a file, never a list.** A new undeclared import fails the future gate unless its author adds a `@boundaries-ignore` comment. Turbo checks that a reason exists, not that it is true. So whether such comments count as evidence is the gate owner's call (KTD1). Governs R3.

### Scope Boundaries

- Changing the gate, its configuration or any lint configuration, in any commit (R5).
- Moving the Deno trace scripts to root `scripts/`. That would also fix the five `@std` reports, but it edits `e2e.yml`, which other open PRs share, and declaring is the smaller compliant change. The gate owner may still prefer it.
- Upstream Turbo work on workspace aliases.
- Stream B's reuse suites and every e2e journey stay untouched.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The gate request is written for its owner.** The PR body has a "Gate enrollment request" section with the measured diagnostic count before and after, the planted-import check the owner should see fail, the seven declarations with their reasons, and the enrollment constraints of `ENFORCEMENT.md:27-32`. It records that `@boundaries-ignore` accepts any non-empty reason: a comment with a false reason silences a real undeclared import (adversarial review, measured with `ts-morph` in a trace script). It asks the owner to decide whether such comments count as evidence (`ENFORCEMENT.md:17`: "never on a field the graded work's author supplied") or to require other routes for the seven. It also states that the tree is clean only after the bench request (KTD3) is applied.
- KTD2. **The concurrency fixture project names its files in `tsconfig.json`.** `include` lists `../../../../../packages/stryker-js-instrumenter/testResources/effect-concurrency/*.ts`, and `fixture-project.js` is deleted. The re-export file was a way of putting files into a TypeScript program; the include states that directly. `tsc --listFiles` gives the same program apart from the deleted file. The cross-package read stays a data read, the same one the test already makes through the file system. #319 declares those resources as a `$TURBO_ROOT$` input of `stryker-e2e-core#test`. `allowJs` stays, because removing it is unrelated to this change. Rejected: twelve `@boundaries-ignore` comments, which would declare imports that exist only because `include` was missing.
- KTD3. **The bench fix is a proposal to the owner of `test/bench/oxlint.config.ts`.** The route that was built, measured and then reverted: `test/e2e-core/tsdown.config.ts` passes `documents: ['./oxlint.config.ts']` to `sourceExports`, so tsdown writes an `./oxlint.config.ts` export into both export maps. Bench re-exports `@systemfsoftware/stryker-e2e-core/oxlint.config.ts`, and `test/bench/tsconfig.node.json` drops its `../e2e-core/oxlint.config.ts` include. Measured before the revert: bench lint ran the same rules over the same files, and a planted `process` global failed it with `no-restricted-globals` both before and after. `turbo boundaries` reported nothing. The owner decides whether to apply it.
- KTD4. **Seven declarations, each naming its evidence.** The vm-runner reason names `packages/stryker-js/package.json` and the alias it declares. The Deno reason names `scripts/deno.json`, the import map the script's shebang loads. Each comment sits directly above its import, which is the only placement Turbo reads (`crates/turborepo-boundaries/src/lib.rs:415-445`). Turbo refuses a comment with no reason (`imports.rs:184-192`).

### Assumptions

- With an explicit `include`, the checker's program holds the twelve definition files as root files instead of through re-exports, and the test's assertion covers exactly that.

### Test Admission

| Candidate                                                   | Verdict | Reason                                                                                                                                |
| ----------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A test asserting `turbo boundaries` exits 0                 | Refused | That is the gate. Under CONST-E7 it belongs to the gate owner (KTD1).                                                                 |
| A test that the fixture `tsconfig.json` lists the resources | Refused | It would re-pin a source text. The existing concurrency-checker scenario already checks that every definition file is in the program. |
| A test for the `@boundaries-ignore` comments                | Refused | They are comments. Removing one makes `turbo boundaries` report that import again, which the gate owner's enrollment observes.        |

### Assumptions This Plan Could Break

- The gate owner may refuse author-supplied `@boundaries-ignore` comments as evidence. Then the seven need other routes: the trace scripts move to root `scripts/`, and the vm-runner alias waits on Turbo. KTD1 asks the owner to decide.
- The bench config's owner may refuse KTD3. Then the gate cannot enroll over a clean tree until that owner chooses another route.
- An `include` that points outside the tsconfig's directory changes the checker's `rootDir` inference. That matters only for emit, and the project sets `noEmit`.

---

## Implementation Units

### U1. Fixture project names its files

- **Goal:** Remove the 12 "leaves the package" reports from `fixture-project.js`.
- **Requirements:** R2, R4.
- **Files:** `test/e2e-core/tests/__fixtures__/effect-concurrency/tsconfig.json`, `test/e2e-core/tests/__fixtures__/effect-concurrency/fixture-project.js` (deleted).
- **Approach:** KTD2.
- **Test scenarios:** None new. The existing `concurrency-checker.integration.test.ts` scenario "the start reports nothing and every definition file is in the program" proves the program still holds every definition file, and the mutant-count scenario proves the checker still sees every mutant.
- **Verification:** `vitest run tests/concurrency-checker.integration.test.ts` in `test/e2e-core` passes, and fails with `uninspectedDefinitionFiles` when the `include` is removed. `turbo query` lists none of the twelve.

### U2. Declare the seven false reports

- **Goal:** Make the seven false reports visible declarations.
- **Requirements:** R3.
- **Files:** `packages/stryker-js/tests/vm-parity.differential.test.ts`, `packages/stryker-js/tests/vm-runner.integration.test.ts`, `test/e2e/scripts/export-traces.ts`, `test/e2e/scripts/import-traces.ts`.
- **Approach:** KTD4.
- **Test scenarios:** None. These are comments only.
- **Verification:** `turbo boundaries` reports none of the seven. Removing any one declaration brings back its diagnostic. `deno check --config=scripts/deno.json` passes on both scripts.

---

## Verification Contract

| Check                    | Command                                                                                               | Done when                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| One diagnostic left      | `pnpm exec turbo query 'query { boundaries { items { import path } } }'`                              | exactly one item, `test/bench/oxlint.config.ts`  |
| Gate catches a new reach | scratch worktree adding `import '../../e2e-core/src/mod.ts'` to a bench file, then `turbo boundaries` | that import is reported; the worktree is removed |
| Fixture program          | U1's test                                                                                             | passes; red without the `include`                |
| Format                   | `./bin/dprint check` on changed files                                                                 | exit 0                                           |
| CI                       | the PR's `check`                                                                                      | green, apart from failures known on `main`       |

## Definition of Done

- R1-R5 hold on the PR head. The PR body carries the bench request (KTD3), the gate enrollment request (KTD1) and the CONST-E7 ownership statement.
- No judgment-surface file appears in the diff (R5): `git diff --name-only origin/main...HEAD` lists only U1's and U2's files and this plan.
- No scratch probe remains in the diff.
