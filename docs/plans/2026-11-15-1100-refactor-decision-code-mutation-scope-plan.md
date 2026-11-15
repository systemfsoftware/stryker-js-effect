---
title: Decision Code Is A Closed, Fully Mutated World - Plan
type: refactor
date: 2026-11-15
topic: decision-code-mutation-scope
artifact_contract: ce-unified-plan/v1
product_contract_source: maintainer-order
execution: code
---

# Decision Code Is A Closed, Fully Mutated World - Plan

## Goal Capsule

- **Objective:** Every project in the Mutation lane reaches and holds a 100 mutation score on its decision logic, and any regression in that score fails `main`'s scheduled Mutation run.
- **Means:** Decision code is a closed import world (KTD2) that mutation scores whole (KTD3), with presentation at the write edge (KTD4) and a gate that reports every verdict (KTD1).
- **Product authority:** the maintainer's order of 2026-11-15:
  - reach 100 % with mutation scoped to decision logic;
  - add guardrails that keep rendering and formatting out of decisions.
- **Supersession:**
  - This plan reverses the 2026-10-12 ruling that mutation selects `*.workflow.ts` only (KTD3).
  - `docs/adr` is retired, because `docs/plans` holds this repository's decisions.
  - The decisions from that folder that are still in force are carried here as KTD7–KTD9.
- **Stop conditions:**
  - **Done:** a scheduled Mutation run on `main` scores every lane project at 100 with 0 Survived and 0 NoCoverage, and its drop audit passes.
  - **Not done:** a lowered `break`, a project removed from the lane, `--baseline`, or a disable comment without an equivalence proof does not meet the Objective.
- **Execution profile:** several PRs across this repository and the org standards repository (`systemfsoftware/systemfsoftware`). There is one PR per guardrail, then one per package per refactor class. The maintainer's agents author them, and the maintainer's lead merges them after review.

## Product Contract

### Summary

Before this work, measured on `main` on 2026-11-15 with mutation selecting workflow files only, the five lane projects scored as follows against `break: 100`:

| Project            | Score |
| ------------------ | ----- |
| stryker-js         | 55.01 |
| instrumenter       | 75.92 |
| typescript-checker | 67.68 |
| vitest-runner      | 73.58 |
| html-reporter      | 0.00  |

There were 1,188 survivors in 100 workflow files. The worst file, `render-clear-text-report.workflow.ts`, held 198 survivors. Its decision was `Rendered{stdout: lines} | Suppressed`, computed by about 690 lines of text helpers. Selecting schema files too (U2) raised the planned mutants from 10,008 to 13,368.

### Problem Frame

- **Nothing bounded what a decision computes.** The workflow lint rules constrain where `Workflow.make` sits, its exports and the purity of its body. They do not constrain what a pure decide computes, or what a workflow's helpers import.
- **The straight-line shell rule pushed presentation into decide.** `sandwich-shell-is-straight-line` forbids branching in a cell's read and write phases, and its fix text said to "move the branch into the cell's decide workflow". So plural, padding and colour branches went into decision code.
- **The gate masked the score.** `stryker gate` stopped at the budget verdict before judging `thresholds.break`. The workflow downgraded that message, so the scheduled run had been red since 2026-10-18 without failing on its score.

### Requirements

**Gate**

- R1. `stryker gate` judges new survivors, the budget and the break. It prints each failing verdict once, then exits on the first in the order break, new survivors, budget. Unusable input (exit 2) still stops it at once.

**Decision-code boundary**

- R2. A `*.workflow.ts` or `*.schema.ts` under `src/` imports only:
  - `effect` and `@systemfsoftware/effect-cell-types`;
  - type-only imports;
  - relative modules that resolve to a workflow or schema file under the same package's `src/`;
  - another workspace package's schemas, used in schema positions;
  - proved kernels named in `decision-code.json`.

  No list of existing offenders exempts a file.
- R3. A decision variant never carries display text. Presentation lives in a pure formatter in a plain module that the write phase calls with the decided outcome.

**Mutation scope**

- R4. Every lane project mutates `src/**/*.workflow.ts` and `src/**/*.schema.ts`. Schema declarations are ignored, and operation bodies, filter predicates and transform callbacks are scored.

**Refactor**

- R5. Each lane project reaches 0 Survived and 0 NoCoverage on decision code.
  - **Class B:** presentation moves out of decisions.
  - **Class A:** re-checks of decoded values move into schemas.
  - **Class C:** one glob implementation.
  - **Class D:** real decisions get per-tag properties.
  - **Class E:** an equivalent mutant is refactored away, or disabled with a written proof.

### Scope Boundaries

- The import-boundary rule and the shell-rule fix text live in the org standards repository. This repository adopts them by clearing its findings.
- How property tests derive their generators from domain schemas is separate follow-up work.
- A Bend kernel for a decision is out of scope until the cleanup is done. When it comes, it is an owner-reviewed kernel named in `decision-code.json`.

## Planning Contract

### Key Technical Decisions

- KTD1. **The gate collects every verdict before exiting.** Each verdict is caught into an `Option`. Each failure is printed once, and the gate fails with the first in break, new-survivor, budget order. _(session-settled: user-approved — chosen over sequential verdicts: a budget breach hid a month of red scores.)_
- KTD2. **Decision code is a closed import world, checked syntactically per file** by `decision-code-imports` in `oxlint-plugin-dmmf-workflow`.
  - A workspace binding is a schema use only in a type position, in an allowlisted argument slot of a schema combinator, or as the receiver of `.make`, `.is`, `.fields`, `.ast` or `.annotations`. The allowlist is derived from the pinned effect version's `Schema` signatures.
  - Relative decision imports and kernel proofs are judged by their real path.

  _(session-settled: user-approved — chosen over a workflow-only import boundary: schema operations and workspace packages escape it.)_
- KTD3. **Mutation selects workflow and schema files,** reversing the 2026-10-12 ruling.
  - Under KTD2, a workflow can delegate pure logic only to another workflow or to a schema file.
  - If schema files were not mutated, any branch could leave the 100 gate by moving into a schema operation.
  - The 2026-10-12 record listed that as its own bad consequence and left it open.

  _(session-settled: user-approved — chosen over workflow-only selection with schema operations banned: that would contradict KTD8.)_
- KTD4. **The shell rule's fix text separates the two kinds of branch.**
  - A branch that chooses a domain outcome goes to the decide workflow.
  - A branch that only formats a decided outcome goes to a pure formatter in a plain module. The formatter returns text, and the phase calls it.

  The write phase's handler record has already chosen the exit code and the I/O by `_tag`, so the text cannot steer behaviour.
- KTD5. **No list of existing offenders.** A file-level baseline hides any new violation in a listed file that still has an old one. Each repository clears its findings when it adopts the rule.
- KTD6. **A numeric field summed into a decision is bounded in its production schema,** so every sum stays finite. There is no overflow decision variant.
  - Counts are non-negative integers no larger than `Number.MAX_SAFE_INTEGER`.
  - Durations are non-negative numbers no larger than `Number.MAX_SAFE_INTEGER`, and may be fractional.

**Rejected alternatives:**

- **Decision-table syntax:** it bans domain-modelling pipeline steps.
- **Branded domain steps:** ceremony, and a `RenderedLine` brand evades them.
- **Import or file-stem bans:** the renderer imported nothing presentational, and a rename evades a stem.
- **Call-graph scope:** combinators and dispatch tables break it, and it is unstable across PRs.
- **Coverage-defined scope:** NoCoverage games it, and it is blind to static mutants.
- **Line caps or branch budgets:** brittle.
- **A `Workflow.prop` helper:** it covers only properties that already draw the whole command, and it would put test-runner surface into a runtime library.

### Standing decisions carried from `docs/adr`

These were recorded in `docs/adr` (last present at `4c17b199fd`) and stay in force.

- KTD7. **File-kind taxonomy** (was ADR-0001).

  | Kind                            | Holds                                                                                                               |
  | ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
  | `*.cell.ts`                     | One outside interaction as `Sandwich.named(name)(read).decide(workflow).write(handlers)`, or a composition of cells |
  | `*.workflow.ts`                 | `Workflow.make` decisions at complexity 1, and the pure helpers they use                                            |
  | `*.schema.ts`                   | Schemas, tagged classes and errors, and the operations of KTD8                                                      |
  | `*.service.ts`                  | `Context.Service` contracts and their static layers, importing no driver                                            |
  | `*.blueprint.ts`, `*.handle.ts` | Cold descriptions and scoped hot values                                                                             |
  | `src/bin/*`                     | The composition root and the CLI command tree                                                                       |
  | `mod.ts`                        | One namespace barrel per published capability                                                                       |

  Nothing outside a driver-backed module (KTD9) throws. Every failure is a `Schema.TaggedError` variant. Workflow properties live in `src/__tests__/<stem>.workflow.property.test.ts`.
- KTD8. **Pure operations over a type live in its own `*.schema.ts`** (was ADR-0002).
  - **What qualifies:** an operation qualifies when its signature names a type that file declares. Its laws sit in the file's in-source `import.meta.vitest` block.
  - **What never goes there:** effects, services, I/O, clocks, randomness, `throw`, `Workflow.make`, or a decision spanning several types.
  - **Scoring:** KTD3 scores these operations again.
- KTD9. **A driver-backed implementation sits flat beside its service** (was ADR-0003).
  - **The service module** imports no driver.
  - **The implementation module** imports the service module and exports module-level `make` and `layer` (plus `layerConfig` when it reads `Config`), with no `*Live` binding.
  - **Who imports it:** only composition roots and tests.
  - **Placement:** there is no `drivers/`, `adapters/` or `store/` folder.
  - **Where interop goes:** Promise and callback interop, `Reflect`, and `throw` translation are confined to these modules and the composition roots. An implementation that needs only Effect stays `static readonly layer` on the service class.

### Sequencing

KTD1 and KTD4 are independent. KTD2 ships in the org standards repository, and KTD3 ships here. The refactor units then run package by package, and each clears that package's KTD2 findings.

## Implementation Units

### PR group 1: guardrails in this repository

- U1. **The gate reports every verdict.**
  - **Waits on:** none.
  - **Requirements:** R1.
  - **PR:** #416, merged as `55c7aa2f76`.
  - **Files:** `packages/stryker-js/src/run-request.cell.ts`, `packages/stryker-js/tests/gate.integration.test.ts`, `.github/workflows/mutation.yml`, and `docs/solutions/logic-errors/a-budget-verdict-that-stopped-the-gate-hid-the-score-break-for-a-month.md`.
  - **Approach:** KTD1. The workflow downgrades a budget breach only when the exit line names the budget.
  - **Test scenarios:**
    - A run over budget and below break names both verdicts and exits on the break.
    - A run with a new survivor and below break does the same.
  - **Verification:** both scenarios fail on the previous cell and pass after it.
- U2. **Mutation selects schema files.**
  - **Waits on:** none.
  - **Requirements:** R4.
  - **PR:** #417, merged as `955814d55c`, and released as stryker-js 23.2.0 in #418 (`cbe3546324`).
  - **Files:** the five lane projects' `stryker.config.ts`, and a no-release change intent.
  - **Approach:** KTD3.
  - **Verification:** `stryker plan --full` counts 13,368 planned mutants, up from 10,008. The ignorer ignores declarations and keeps filter and transform callbacks.
  - **Outstanding:** adding `stryker-js-plugin-interface` to the lane; it needs the mutation devDependencies.

### PR group 2: org standards repository

- U3. **Presentation at the write edge.**
  - **Waits on:** none.
  - **Requirements:** R3.
  - **PR:** `systemfsoftware/systemfsoftware` #1022, merged as `bb65d09683`.
  - **Files:**
    - `sandwich-shell-is-straight-line.config.ts`;
    - `compound-packs/cell-architecture/presentation-is-a-formatter-the-write-phase-calls.md`;
    - `compound-packs/schema-modelling/foreign-wire-shapes-are-the-encoded-side.md`.
  - **Approach:** KTD4.
  - **Verification:** the plugin's tests and lint pass.
- U4. **The decision-code import boundary.**
  - **Waits on:** none.
  - **Requirements:** R2.
  - **PR:** `systemfsoftware/systemfsoftware` #1023, open.
  - **Files:** `decision-code-imports.ts` and its tests, the shared import-origin package, the presets, and `decision-code.json`.
  - **Approach:** KTD2 and KTD5. The rule is on at `error`, released as a major bump.
  - **Test scenarios:** each review finding has a RuleTester case that fails on the previous rule.
  - **Verification:** the rule reports nothing in the org standards repository. A dry run on this repository's `main` reports 22 findings in 18 files.

### PR group 3: refactor in this repository

- U5. **Class B, reporters.**
  - **Waits on:** U3 merged.
  - **Requirements:** R3, R5.
  - **PR:** #419, draft.
  - **Files:**
    - the clear-text, progress and JSON report workflows and cells;
    - the new formatters `render-clear-text-report.ts`, `render-progress-report.ts` and `render-json-report.ts`.
  - **Approach:** KTD4 and KTD6.
  - **Verification:** a Stryker run restricted to the three files went from 214 survivors to 0. That was measured before the property tests were redrawn from production schemas, and is re-measured after. Output was byte-identical across 433 clear-text and 314 progress cases.
- U6. **Class B, the other renderers.**
  - **Waits on:** U3 merged.
  - **Requirements:** R3, R5.
  - **PRs:** #421 (stryker-js: frame-run-event, annotations, config import failure, the config-error and missing-shard text) and #422 (instrumenter: resolve-format); #420 tests html-reporter's write span.
  - **Approach:** KTD4. `describe-config-error` and `describe-missing-shard-mutants` held no domain choice, so they became plain formatters.
  - **Verification:** every touched decision file reports 0 Survived and 0 NoCoverage. A differential run compared the old output with the new decision plus formatter.
- U7. **Classes A, C, D and E, and clearing U4's findings.**
  - **Waits on:** U4 merged and this repository's preset upgraded. Before that, each package can be checked against the unreleased rule.
  - **Requirements:** R2, R5.
  - **Approach:** one PR per package per class, ordered from leaf packages to `stryker-js`.
  - **Verification:** the touched project's Stryker run reports 0 Survived and 0 NoCoverage, and lint reports no U4 finding.

## Verification Contract

- **Per PR:** `pnpm turbo run build lint typecheck test` for each touched package. In the dev shell, `stryker run --mutate <files>` restricted to the touched decision files reports 0 Survived and 0 NoCoverage.
- **On `main`:** the scheduled Mutation run's per-project scores and its drop-audit verdict.

## Definition of Done

- The stop condition in the Goal Capsule holds on a scheduled `main` run.
- U4 is on in this repository, with zero findings, no disable comments and no list of offenders.
- Each of these fails lint:
  - a scratch workflow that imports a plain module;
  - a schema file that calls a workspace function;
  - `Arr.map(xs, PI.fn)`.
- A run that is over budget and below break fails on the break.
- No code from abandoned refactor attempts remains.
