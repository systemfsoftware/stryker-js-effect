# @systemfsoftware/stryker-bench

The report-only A/B bench lane's orchestrator. One CI job builds the PR's
merge-base with its base branch (side A) and the PR head (side B) on the same
runner, runs both interleaved over two corpora, and reads every number from
each run's own NDJSON. Nothing here compares statuses, stores a baseline, or
fails a PR on a timing delta.

`pnpm --filter @systemfsoftware/stryker-bench bench` runs `src/main.ts` through
`tsx` with the workspace source condition, so the orchestrator itself needs no
build step.

## Corpus selection rule

`corpus.json` declares both corpora and is changed only by a reviewed edit. The
repo corpus is a pinned three-file slice chosen so that every phase does real
work on every run:

- the instrumenter runs on all three files;
- the TypeScript checker does real work through the CompileError verdicts in
  two of the three files, and one file configures no checker, so the `not-run`
  check cell is exercised on every repetition;
- the dry run and mutant execution both run on each file;
- no file had a `Timeout` verdict on main, because a timeout measures the
  timeout setting rather than the engine.

`packages/stryker-js` is deliberately excluded: its dry run runs 1,099 tests
and would dominate every repetition. Each entry, and the enterprise fixture, is
its own project in the report; a repetition of a project is one CLI run.
