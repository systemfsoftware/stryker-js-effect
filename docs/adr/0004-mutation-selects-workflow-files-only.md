---
status: "accepted"
date: 2026-10-13
decision-makers: ["ryan"]
supersedes: ["ADR-0002 (mutation selection)"]
---

# Mutation selects workflow files only

## Context and Problem Statement

This record supersedes ADR-0002 in part only: its statements that the mutation run grades `src/**/*.schema.ts` (line 16), that a schema file is "mutated" (lines 38, 46 and 69), and that "schema files are mutated against a break threshold of 100" (line 42). ADR-0002's decision on where pure operations over a schema's data live stays in force, as do its in-source laws.

ADR-0001 (line 25) states that each package's mutation config grades only `src/**/*.workflow.ts`, but the configs never matched it. The cell-architecture rewrite (`1cf39f2b`, 2026-09-26), the commit that added ADR-0001, gave the dogfood configs in `packages/stryker-js`, `packages/stryker-js-vitest-runner` and `packages/stryker-js-typescript-checker` `mutate: ['src/**/*.workflow.ts', 'src/**/*.schema.ts', …]`, and no later commit changed those globs. ADR-0002 changed no config. It took the schema glob as a given (its line 16) and placed pure operations in schema files partly because those files were already mutated (its line 38). On main at `25120175` those globs select 62 schema files and 101 workflow files. Main's Mutation run on that commit (run 38338484710, artifact `mutation-report-459`) scored 2,213 mutants in 60 of the schema files, beside 7,675 in the workflow files. The mutate set is a judgment surface: it decides which code the other streams' tests are graded against.

On 2026-10-12 at 22:47 EDT Ryan ruled that mutation selects `*.workflow.ts` only, and that `*.schema.ts` is never in a mutate set.

## Decision Drivers

- The mutate set grades decisions, and decisions live in `*.workflow.ts` files (ADR-0001, line 44).
- One rule for the dogfood projects this record covers, so a schema file is never graded in one of them and skipped in another.
- A project with nothing to mutate has no config. The fork scores an empty mutate set as Unscored and exits 0, which would look like a pass.

## Considered Options

- Workflow and schema files, as before.
- Workflow files only.

## Decision Outcome

Chosen option: "Workflow files only", because Ryan ruled on 2026-10-12 that a mutate set selects `*.workflow.ts` files and never `*.schema.ts`. That also brings the configs in line with the rule ADR-0001 (line 25) states.

The three dogfood `stryker.config.ts` files this record covers, in `packages/stryker-js`, `packages/stryker-js-vitest-runner` and `packages/stryker-js-typescript-checker`, select `src/**/*.workflow.ts` and no `*.schema.ts` glob. A project with no workflow file deletes its config instead of keeping a mutate set that selects nothing. The project's ignorers stay, because they act on the mutants that the selected files contain. `@systemfsoftware/stryker-ignorer-effect-schema-declarations` still matched 744 of those mutants in workflow files on `25120175`: tagged-class tags and fields, symbol descriptions, tagged-struct tags, class identities, and generation and check annotations.

`test/e2e-core/stryker.config.ts` is not covered by this record and still names `src/**/*.schema.ts`. Since #337, `test/e2e-core` is in neither Mutation's nor the kill matrix's project list, so no dogfood run grades it. Stream D's dissolution of `test/e2e-core` removes the config.

### Consequences

- Good, because the score measures the tests of decisions and nothing else.
- Good, because the main run carries 2,213 fewer mutants across the three projects, measured on `25120175`.
- Bad, because the pure operations ADR-0002 places in schema files are no longer graded by mutation. ADR-0002 chose schema files because they were both mutated and importable from a workflow (its line 38). This record removes the first half of that reason and keeps the placement. Whether those operations should move into workflow files is a separate decision, not made here. Their in-source laws still run in every test run.
- Neutral: baselines taken from main's mutant set shift once. That covers the kill matrix and the default-policy drop audit that reads it.
- Neutral: two dated plans state the old two-glob set as a premise. `docs/plans/2026-10-13-0410-feat-mutant-quality-plan-v3.md:45` counts mutated files under it, and `docs/plans/2026-10-13-1453-fix-stryker-stream-files-out-of-project-inputs-plan.md:110` grounds a waiver on it. Their owners re-derive those rows against this record; this change does not edit another stream's plan.

### Confirmation

- Review: none of the three covered `stryker.config.ts` files names a `*.schema.ts` glob in `mutate`. `test/e2e-core/stryker.config.ts` keeps its glob until Stream D removes it.
- Mutation's merged report on the next main run lists no `*.schema.ts` file for these three projects.

## Pros and Cons of the Options

### Workflow and schema files

- Good, because schema-file operations are graded.
- Bad, because declarations and decisions are graded together, so the score mixes declaration mutants with the tests of decisions.

### Workflow files only

- Good, because the graded population is exactly the decisions.
- Bad, because schema-file operations lose mutation grading.
