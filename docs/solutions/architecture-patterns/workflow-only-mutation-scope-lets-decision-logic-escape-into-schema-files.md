---
title: Workflow-only mutation scope lets decision logic escape into schema files
date: 2026-11-15
category: architecture-patterns
module: repo
problem_type: architecture_pattern
component: mutation-scope
severity: high
applies_when:
  - "a project's mutate set selects *.workflow.ts but not *.schema.ts"
  - "workflow files may import pure operations from schema files"
  - a survivor disappears from the report after its logic moves to another file without a new test
retire_when: "decision code can import nothing that mutation does not score"
tags: [mutation-scope, stryker-config, schema-operations, import-boundary, decision-code]
---

# Workflow-only mutation scope lets decision logic escape into schema files

## Context

From 2026-10-12, every lane project's `stryker.config.ts` selected `src/**/*.workflow.ts` only. Pure operations over a type live in its own `*.schema.ts` (plan KTD8), and a workflow may call them. In practice that put decision logic out of reach of the mutation gate: on 2026-11-15, 40 schema files held 170 operation functions, and 110 of 128 workflow files carried 997 same-file helpers that could move into those files.

The 2026-10-12 selection record named this cost itself: "the pure operations … placed in schema files are no longer graded by mutation", and it left whether they should move into workflows undecided.

## Guidance

Mutation scope is the set of files decision code may import, not one file kind. When the import boundary lets a workflow call a schema operation (`decision-code-imports` in the org's `oxlint-plugin-dmmf-workflow`), the mutate set selects both:

```typescript
export default { mutate: ['src/**/*.workflow.ts', 'src/**/*.schema.ts'] }
```

Keep the effect-schema-declarations ignorer on. It ignores tags, ids, brands, annotations, defaults and generation-only links, and keeps filter predicates and transform callbacks scored, so only executable logic enters the gate.

Before widening scope, measure what it adds without running tests: `stryker plan --full --target-seconds <n> --max-shards <n> --projects <list>` counts planned mutants per project.

## Why This Matters

A scope narrower than the import boundary is a hole: any branch can leave the 100 gate by moving into a file the boundary allows and the mutate set skips, with no test added. A scope wider than the boundary grades code that decisions cannot reach. Matching the two is what makes the score mean "the decisions are tested".

## When to Apply

- Changing a project's `mutate` globs.
- Changing what decision code may import.

## Examples

Measured with `stryker plan --full` before and after adding `src/**/*.schema.ts` (#417):

| Project            | Before | After  |
| ------------------ | ------ | ------ |
| stryker-js         | 7,849  | 10,006 |
| typescript-checker | 1,033  | 2,023  |
| vitest-runner      | 168    | 220    |
| instrumenter       | 943    | 1,104  |
| html-reporter      | 15     | 15     |

## Related

- `docs/plans/2026-11-15-1100-refactor-decision-code-mutation-scope-plan.md` (KTD2, KTD3)
- `docs/solutions/architecture-patterns/a-decision-that-carries-rendered-text-puts-presentation-under-the-mutation-gate.md`
- `docs/solutions/logic-errors/a-budget-verdict-that-stopped-the-gate-hid-the-score-break-for-a-month.md`
