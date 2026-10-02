---
title: A failure record is the only rendering of a failure; nothing next to it may restate it
date: 2026-10-02
category: best-practices
module: stryker-js failure reporting
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - adding a new failure path that raises a `RunFailure` or a tagged error with an `evidence` getter
  - writing the `message` of an error class that also declares evidence
  - adding stderr logging, CI summary text or annotations about a failed run
  - asserting failure output in tests or e2e journeys
symptoms:
  - "A gate refusal printed the new survivor id four times on stderr: a logError line, the record's evidence, the carrier's message and the carrier's stack header"
  - "A failed dry run printed `Initial test run failed ...` from a logError before the record said the same thing"
  - "A dry-run cause link dumped the whole `DryRunFailed` decision object, stack included, through the Formatter fallback"
  - "The CI summary called a vacuous-property dry-run failure an infrastructure failure"
tags:
  - failure-record
  - diagnostics
  - stderr
  - cause-chain
---

# A failure record is the only rendering of a failure; nothing next to it may restate it

## Context

A failed run ends in one `FailureRecord.FailureRecord` from `@systemfsoftware/stryker-js-cli-contract`. That record is printed on stderr through `terminalTextOf`, emitted as the schema-3.0 `error` stream event, written to the run's `failure.json` under its mutation reports directory (`FAILURE_RECORD_FILE`), and turned into the CI summary and annotations by `markdownOf`/`annotationsOf` (`render-failure.ts`). Stack PRs #146-#151 introduced it after mutation run 36935602456 reported a vacuous in-source property in the dry run as an "infrastructure failure (missing binary, crashed run or timeout)".

The cutover worked on the first pass but still produced noisy, contradictory output, because old renderings survived next to the record.

## Guidance

1. **No log line about a failure the record carries.** A cell that fails with a `RunFailure` must not also `Effect.logError` the same fact. The removed offenders were `explainGateRefusal` in `run-request.cell.ts` and the `Initial test run failed. N of M test(s) failed` log in `dry-run.cell.ts`. Integration tests that captured those logs were pinning a duplicate; assert on the evidence instead.
2. **An error that declares evidence keeps a one-line summary `message`.** The record renders the evidence. If the message lists the same data, every cause link repeats it. `GateRejected.message` is now `stryker gate: N new survivor(s) absent from the committed baseline`, and the survivor list lives only in `NewSurvivors.survivors`.
3. **`RunFailure.cause` holds a real error, never the decision data.** `writeDryRunFailed` used to pass the `DryRunFailed` decision as the cause. `messageOf` in `conclude-run.ts` falls back to `Formatter.format` for non-Error objects, so the whole decision, stacks included, landed in the cause chain.
4. **A cause link's stack keeps only its `at` frames.** A V8 stack starts with `Name: message`, so storing it whole prints the message twice. `linkOf` in `conclude-run.ts` drops the lines before the first `at` frame.
5. **Stacks show on the terminal only when nothing else locates the failure.** `terminalTextOf` and `markdownOf` print cause stacks only for `CatalogGap` records, and a failed test's stack only when it has no `location`. `failure.json` keeps every stack.
6. **Paths in evidence are project-relative.** The runner reports paths inside `.stryker-tmp/sandbox-*`, which is deleted after the run. `projectTestOf` in `dry-run.cell.ts` relativizes the test `file` and strips the sandbox prefix from the stack. The Vitest runner names file-level failures by their project-relative path.
7. **CI text comes only from the record.** The mutation job's `buildSummary` and `buildRequireError` (`mutation-plan.ts`) render the stream's terminal record, or build `RecordMissing`, `JobTimedOut` or `BinaryMissing` through `recordFor` when no record exists. A summary label must never replace the outcome: "evaluated no mutants" is appended to "failure", never shown instead of it.

## Why This Matters

Each duplicate is a second, drifting description of the same failure. An agent reading stderr cannot tell which line is authoritative. Duplicated or missing data also breaks the exact-count assertions that consumers write: the gate test counts survivor ids, and annotations must cover exactly the located evidence. And output that claims a cause the run never had sends the reader to fix the wrong thing.

## When to Apply

- Any new code path that ends a run in failure, or any new error class with an `evidence` getter.
- Any change to `render-failure.ts`, `conclude-run.ts` (`linkOf`, `messageOf`), or the CI scripts' summary.

## Examples

Gate refusal on stderr, before (one id, four times):

```text
ERROR (#1): stryker gate: 1 new survivor(s) absent from the committed baseline:
  src/sum.js:4 4d4d4d4d4d4d4d4d
...
GateRejected: stryker gate: 1 new survivor(s) absent from the committed baseline:
  src/sum.js:4 4d4d4d4d4d4d4d4d
  GateRejected: stryker gate: ...   <- stack header repeating the message
```

After:

```text
NewSurvivors: Mutants the change can affect survived every test and are absent from the accepted survivor baseline.
survivors: 1 listed, 2 unchecked
src/sum.js:4 4d4d4d4d4d4d4d4d
GateRejected: stryker gate: 1 new survivor(s) absent from the committed baseline
next: killSurvivor
```

## Related

- `docs/plans/2026-10-01-2306-feat-agent-ready-failure-diagnostics-plan.md`
- `docs/solutions/test-failures/stream-schema-must-not-carry-json-rest-records.md`
