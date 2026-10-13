---
title: A cell input that may never arrive is a tagged command field the read folds into, not an optional
date: 2026-10-13
category: architecture-patterns
module: stryker-js
problem_type: architecture_pattern
component: service_layer
severity: medium
applies_when:
  - a Sandwich cell's read consumes a stream and the event its decision needs may not be in it
  - a workflow command would otherwise carry an optional field whose absence means "it never arrived"
  - converting a reporter factory or other stream consumer into a cell
retire_when: "Workflow.make accepts a union command schema (CommandSchema in @systemfsoftware/effect-cell-types requires fields), or sandwich-shell-is-straight-line admits Option.match in a read"
tags: [sandwich, workflow-make, tagged-union, stream-runfold, schema-laws, reporter]
---

# A cell input that may never arrive is a tagged command field the read folds into, not an optional

## Context

A reporter cell reads the reporter event stream and decides from the last `mutationTestReportReady` report, but a run can end without one. The SARIF reporter met this while it moved from a factory into its own cell (PR #324). Three rules decide where "no report arrived" can live, and each obvious encoding breaks one of them:

- **`S.optional(report)` on the command**: breaks the schema-laws pack rule `tagged-unions-over-state-by-presence` ("Absence never carries meaning"; an `Option`/`NullOr` field only renames the hole), and the field it correlates with (`survivors`) is meaningless without the report.
- **A command that is itself a union of "reported" and "not reported"**: `Workflow.make` refuses it. Its `CommandSchema` type (`@systemfsoftware/effect-cell-types`) requires a struct with `fields`.
- **`Option.match(last, { onNone, onSome })` in the read to build the right variant**: oxlint refuses it with `sandwich-shell-is-straight-line` ("a branch-callback dispatch inside the read phase of a Sandwich cell").

`jsonReportCell` still carries the optional shape (`JsonReportCommand.reported` is `S.optional(...)`), so copying that sibling reproduces the problem.

## Guidance

Put the presence in **one field of the struct command** as a tagged union, declare the variants as plain `S.TaggedStruct` data (they are neither the command nor decision variants, so the `data-only-schema-classes` rule gives them no class), and let the read **fold** the stream into that field with the absent variant as the seed. The fold has no branch: each element replaces the accumulator, and an empty stream leaves the seed.

```ts
// sarif-report.workflow.ts
export const SarifReported = S.TaggedStruct('SarifReported', {
  report: Report.MutationTestResult,
  survivors: S.Array(SurvivorRef),
})
export const SarifNotReported = S.TaggedStruct('SarifNotReported', {})

export class SarifReportCommand extends S.TaggedClass<SarifReportCommand>()('SarifReportCommand', {
  reported: S.Union([SarifReported, SarifNotReported]),
  tool: SarifToolSchema,
  maxResults: S.Natural,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

// decide dispatches on the tag, closed by Match.exhaustive
Match.value(command.reported).pipe(
  Match.tag('SarifReported', (reported) => reportedOf(command, reported)),
  Match.tag('SarifNotReported', (): SarifReportDecision => SarifReportSuppressed.make({})),
  Match.exhaustive,
)
```

```ts
// sarif-report.cell.ts: the read stays straight-line
Stream.fromAsyncIterable(input.events, failAsSarif).pipe(
  Stream.filterMap(reportOf),
  Stream.runFold(
    (): Reported => NOT_REPORTED, // { _tag: 'SarifNotReported' }
    (_, report): Reported => ({ _tag: 'SarifReported', report, survivors: survivorsOf(report) }),
  ),
)
```

The decision gains its own variant for the absent case (`SarifReportSuppressed`), and the write maps it to `Effect.void`.

## Why This Matters

The fold keeps the read a single path, the command stays a struct `Workflow.make` accepts, and the absent state is a tag the decision matches instead of a hole it probes. Data that only exists with the report (`survivors`) moves into the variant that owns it, so a "not reported" command cannot carry survivors. The property law can then grade the absent case directly: draw a command and swap in the absent variant.

## When to Apply

- Any Sandwich read that ends a stream with `Sink.last`/`Option` and passes the result to a workflow.
- Any time a draft reaches for `S.optional` on a workflow command to say "this did not happen".

## Examples

The `sarifReport` workflow and `sarifReportCell` (PR #324), with the law `∀c_SarifReportCommand_≡SuppressedIffNotReported` beside the workflow.

## Related

- Plan `docs/plans/2026-10-12-2348-refactor-reporter-namespace-plan.md` (D5)
- Compound Pack `schema-laws` (declared in `.compound-engineering/config.yaml`): rules `tagged-unions-over-state-by-presence` and `data-only-schema-classes`
