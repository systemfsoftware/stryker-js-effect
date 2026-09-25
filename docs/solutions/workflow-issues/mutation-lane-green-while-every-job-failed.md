---
title: The mutation lane went green while every job failed, because each gate accepted evidence that a dead run still leaves behind
date: 2026-09-25
category: workflow-issues
module: ci-workflow
problem_type: workflow_issue
component: tooling
severity: high
applies_when:
  - "Changing the Mutation workflow, the mutation-job runner, or its no-report gate"
  - "Deciding which file or exit code proves that a Stryker run produced a result"
  - "Pointing a package's Stryker config at a runner or checker plugin that is also a workspace package"
symptoms:
  - "Every Mutation job and the report job show success while each job log ends in a Stryker exit 3 or 4"
  - "merge-reports prints 'Merged 0 of 3 package report(s)' with [WARN] rows and exits 0"
  - "A package's own runner or checker plugin fails to load with ImportFailed in its own mutation job"
root_cause: missing_validation
resolution_type: workflow_improvement
tags: [mutation-testing, github-actions, silent-pass, ci-gate, stryker, continue-on-error, self-reference]
---

# The mutation lane went green while every job failed, because each gate accepted evidence that a dead run still leaves behind

## Problem

Every Mutation job in run 36160660790 on `main` showed green. In fact the `stryker-js` dry run hit its wall-clock limit (exit 3), and the vitest-runner and typescript-checker packages could not load their own plugins (exit 4). Nothing in the pipeline failed on either outcome.

## Failure mechanisms

1. **The exit code was discarded.** The Mutation step ran with `continue-on-error: true`, so a non-zero Stryker exit never reached the job's conclusion.
2. **The report gate accepted a file that every run writes.** The "require a mutation part" step accepted `mutation-stream.jsonl` in place of `mutation-report.json`. The run-event stream sink opens that file on the first event, so a run that dies in `prepare` still leaves it behind. The gate could therefore fail only for a run that never started.
3. **The merger treated absence as success.** `stryker merge-reports` fails on unreadable or duplicate parts but exits 0 when 0 of N packages have a report.
4. **The config resolved its own package.** A package's Stryker config called `import.meta.resolve` with that package's own name. Node answers a package's own name through its `exports` map (self-reference), so the config loaded the package's own unbuilt build output instead of the installed copy. The mutation job never builds that output, and the dogfood rule requires the published `catalog:stryker` copy anyway.

## Architectural invariants

**A result gate keys on the artifact that only a finished run writes.** For Stryker that artifact is the JSON report. The stream file, logs, and the incremental file all exist after crashed, timed-out, or barely started runs. `buildRequireError` fails a package that leaves no report, while `buildSummary` separates "no report" from a low score. A low score alone never fails the job.

**The artifacts a gate reads are cleared before the run that is meant to produce them, on every path.** Otherwise a report left over from an earlier run satisfies the gate for a run that wrote nothing. `runJob` removes the previous report and stream before it runs a package, and also before it skips a package whose job budget is spent. The skip path fails the job.

**A step whose exit code is the verdict never gets `continue-on-error`.** Classify "infrastructure failure" versus "score below threshold" inside the script that reads the report, and let infrastructure failures fail the step.

**A plugin is resolved from the installed tree, never by the host package's own name.** `installedPlugin(specifier, import.meta.url)` resolves through `createRequire` rooted at the config directory's `node_modules/`. That always reaches the installed (published) copy, whatever the host package's own `exports` say.

```text
BAD   plugin: import.meta.resolve('<this package>')     -> <this package>/dist (self-reference)
GOOD  plugin: installedPlugin('<this package>', import.meta.url) -> node_modules/<this package> (catalog copy)
BAD   gate:   report.json OR stream.jsonl present        -> passes for runs that died in prepare
GOOD  gate:   report.json present (after clearing it)    -> fails every run that did not finish
```

## Verification

- The Deno tests for `buildRequireError` and `buildSummary` cover four inputs: a complete report, an invalid report, a stream with zero mutants, and a partial stream. A cleared reports directory never satisfies the gate.
- The `installedPlugin` tests resolve a specifier whose host package self-references and assert that the installed copy is returned.
- Smoke check: run `runJob` with `pnpm` stubbed to exit 3 while a stale report sits in the package's reports directory. The job must exit 1 with a `Mutation produced no report` annotation.

## Applicability

This applies to any gate that decides "did the tool produce a result" from files on disk. List the files a crashed, timed-out, or never-started run still leaves behind; each one is a silent-pass route. `docs/solutions/workflow-issues/matrix-legs-rename-the-required-status-check.md` describes the other shape of the same failure: a guard that stops reporting goes silent, not red.
