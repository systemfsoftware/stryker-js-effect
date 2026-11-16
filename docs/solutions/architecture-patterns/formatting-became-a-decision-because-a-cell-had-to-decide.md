---
title: Formatting became a decision because a cell had to decide
date: 2026-11-15
category: architecture-patterns
module: stryker-js
problem_type: design_flaw
component: reporters
severity: high
applies_when:
  - an operation only lays out what it read, but is built as a cell with a workflow
  - a workflow's tags differ only in what text is written, or in whether anything is written
  - a property test recomputes which tag a workflow should choose
  - a workflow is called from a handle, service, plain module, or a cell's read or write code
retire_when: "every reporter runs on Sandwich.writer, and no workflow in the repository is referenced outside a cell's .decide, another workflow, or a test"
tags: [cell-architecture, workflow, decision, reporter, property-testing, mutation-testing, effect-cell-types]
---

# Formatting became a decision because a cell had to decide

## Problem

Five reporters (clear-text, json, progress, sarif, html) each ran through a cell whose `.decide` called a workflow. The clear-text workflow returned `ClearTextReportSummarized | ClearTextReportDetailed | ClearTextReportSuppressed`. It built that from about 130 lines that copied fields from the mutation result and metrics into a view. Its tags differed only in what text the write phase printed, or in whether it printed anything.

Its property tests restated the code. `∀c_Command_≡TagTable` computed an `expectedTag` from `reported`, `computed` and `debug` with the same branch the workflow used, then checked that the workflow agreed. The other properties re-derived each copied field. Such a test passes whatever the code does, so it proves nothing about the reporter.

## Symptoms

- A workflow per reporter, with tagged "decisions" that no write phase acts on differently except in the text it writes.
- Property tests with an `expectedTag`, a tag table, or a field-by-field copy of the projection.
- 1,188 surviving mutants across 100 workflow files when mutation was scoped to workflows; the clear-text workflow alone held 198.
- Measured on `main` on 2026-11-15: 126 workflows under `src/`, of which 31 are some cell's `.decide`. The other 95 are called from cell read or write code, handles, services, plain modules and blueprints, and only 2 from another workflow.

## What Didn't Work

- **Rewriting the tag-table tests as "laws".** Partition, provenance and additivity properties over the clear-text projection were true. They still tested a projection dressed as a decision, and the decision itself stayed fake.
- **Asking whether the definition of a decision can be applied to the 95 off-cell workflows.** It could not, because they run outside any cell. With no write phase acting on their tags, "does each tag lead to a different effect?" has no answer. The code was wrong, not the definition.
- **Treating it as a pack-wording problem alone.** Better pack text cannot help while the library offers no way to build a cell without a decision.

## Solution

1. **A cell shape with no decide.** `effect-cell-types` 12.2.0 adds `Sandwich.writer(name)(read).decode(Command).write({ Decoded, CommandRejected })`. It has the same span, child spans, declared attributes and duration histogram with `result_class` as a decided cell, and it records no decision. A reporter is a writer whose `Decoded` handler calls a plain formatter.
2. **One definition of a decision.** A decision is a `Workflow.make`, run by a cell's `.decide`, whose tags lead the write phase to different domain effects:
   - an exit code or verdict;
   - persisting or skipping a domain record;
   - running, retrying or dropping work;
   - a state transition.

   Laying out an outcome decided elsewhere is presentation, even when the output is machine-readable.
3. **A writer cannot hide a branch.** `sandwich-shell-is-straight-line` (`oxlint-plugin-cell-architecture` 7.1.0) holds a writer's `read` and handlers to the same rule as a decided cell's.
4. **Tests that state something independent of the code.** A formatter keeps schema-drawn law properties (partition, finiteness, additivity) and output tests on a known report. Per-tag properties belong only to real decisions.

## Why This Works

The library's only cell shape required a workflow. That gave every operation, including one with nothing to choose, a reason to invent a decision. The packs then asked for a property per tag, and for an invented decision the only such property is the branch itself. Once a cell can be built without a decision, a workflow exists only where a domain outcome is chosen. Then every tag has an effect a property can state without restating the code.

## Prevention

- Before writing or reviewing a workflow, answer: which domain effect differs per tag? If none, it is a writer and a formatter.
- A property that recomputes the tag the code should choose (`expectedTag`, a tag table) is a violation, not a test.
- A workflow runs only through a cell's `.decide`, inside another workflow, or in a test. The workflow-reference lint in the cell-architecture lint plugin enforces this.

## Related Issues

- `docs/plans/2026-11-15-1100-refactor-decision-code-mutation-scope-plan.md`
