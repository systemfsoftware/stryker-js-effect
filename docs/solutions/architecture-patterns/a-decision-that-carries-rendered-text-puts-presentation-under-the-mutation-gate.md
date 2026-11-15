---
title: A decision that carries rendered text puts presentation under the mutation gate
date: 2026-11-15
category: architecture-patterns
module: stryker-js
problem_type: architecture_pattern
component: reporters
severity: high
applies_when:
  - "a workflow's decision variant carries lines, colours, padding or other display text"
  - a cell's write phase needs a branch and a lint fix text says to move every branch into decide
  - most of a workflow file's survivors sit in helpers that pluralise, pad or colour text
retire_when: "every lane project scores 100 on decision code and no decision variant carries display text"
tags: [mutation-score, presentation, decision, sandwich, write-phase, formatter, reporter]
---

# A decision that carries rendered text puts presentation under the mutation gate

## Context

On 2026-11-15 `render-clear-text-report.workflow.ts` held 198 of the 1,188 survivors in the lane's workflow files. Its decision was `ClearTextReportRendered{stdout, diagnostics, stderr} | ClearTextReportSuppressed`, and about 690 lines of same-file helpers built those lines: plurals, padding, colours, emoji and tables. The progress and JSON report workflows had the same shape. Those counts come from the scheduled Mutation run on `main`.

The org's `sandwich-shell-is-straight-line` rule caused it. The rule forbids branching in a cell's read and write phases, and its fix text said "move the branch into the cell's decide workflow". So every display branch went into decision code, and the mutation gate graded string formatting as if it were a domain decision.

## Guidance

- A decision is the domain outcome: which variant, carrying which domain data (counts, scores, ids, paths). How that outcome reads on a terminal is presentation.
- Presentation is a pure formatter in a plain module, for example `render-clear-text-report.ts`. The cell's write phase calls it with the decided outcome. The formatter returns text only, and may branch freely.
- When a write phase needs a branch, ask what it chooses. If it chooses a domain outcome, it is a decision variant. If it chooses only how a decided outcome looks, it belongs in the formatter.
- A workflow with no domain choice left stops being a workflow. `describe-config-error` and `describe-missing-shard-mutants` became the plain formatters `config-error-text.ts` and `missing-shard-mutants-text.ts`.

The org rule's fix text now draws this line (`systemfsoftware/systemfsoftware` #1022, pack rule `cell-architecture/presentation-is-a-formatter-the-write-phase-calls.md`).

## Why This Matters

- The write phase's handler record chooses the exit code and the I/O by the outcome's `_tag`, so a formatter's text cannot steer behaviour. Its mistakes are cosmetic, and its property tests (a distinct label per status, layout invariants) cover it.
- Mutants in display helpers are mostly equivalent or unkillable without asserting exact strings. Keeping them in the gate meant the score could not reach 100, and the effort to raise it went into string assertions instead of decisions.

## When to Apply

- A decision variant field is typed as text meant for a reader (`stdout`, `lines`, `message`, `reason` built by the workflow).
- A workflow imports colour, padding or table helpers, or defines them in the same file.

## Examples

Before: the decision is lines of text.

```typescript
class ClearTextReportRendered extends S.TaggedClass<ClearTextReportRendered>()('ClearTextReportRendered', {
  stdout: S.Array(S.String),
}) {}
```

After: the decision is the outcome, and write formats it (field names simplified).

```typescript
class ClearTextReportSummarized extends S.TaggedClass<ClearTextReportSummarized>()('ClearTextReportSummarized', {
  files: S.Array(FileScore),
  undetected: S.Array(Survivor),
}) {}
// write: { ClearTextReportSummarized: (summary) => Console.log(renderClearTextReport(summary)), ... }
```

#421 and #422 took their touched decision files to 0 Survived and 0 NoCoverage in Stryker runs restricted to those files, and a differential run against the old implementations matched on 3,000 drawn inputs per surface. In a local Stryker run restricted to the three report workflows, #419 went from 214 survivors to 0, measured before its property tests were redrawn from production schemas, with output byte-identical across 433 clear-text and 314 progress cases.

## Related

- `docs/plans/2026-11-15-1100-refactor-decision-code-mutation-scope-plan.md` (KTD4)
- `docs/solutions/architecture-patterns/workflow-only-mutation-scope-lets-decision-logic-escape-into-schema-files.md`
