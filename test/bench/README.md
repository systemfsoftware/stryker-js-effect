# @systemfsoftware/stryker-bench

The report-only A/B bench lane's orchestrator. The `bench` workflow runs one job
per corpus entry (`BENCH_ENTRY`); each job builds the PR's merge-base with its
base branch (side A) and the PR head (side B) on the same runner, runs both
interleaved over that entry's workload, and reads every number from each run's
own NDJSON. Nothing here compares statuses, stores a baseline, or fails a PR on
a timing delta. When the job's `BENCH_DEADLINE_MS` stops or precedes a run, the
report aborts with `budget-exceeded`; when it passes while setup is still
running, the report aborts with `setup-timed-out` and no run starts.

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

Each entry is bounded so its eight runs fit the job budget (10 minutes per
job): a repo entry may pin `mutate` line ranges and `testFiles`, and the
enterprise fixture pins `mutate` to four files, the same on both sides. The
bound shapes timing only; it never feeds a verdict.

Every run starts from its side's tree exactly as setup left it. Before each
run the bench restores the project directory to the snapshot it took after
setup, outside `node_modules`: files a run added are removed, changed files
are put back, and the Vitest results cache under `node_modules/.vite` is
deleted. Without that, one run's leftovers (reports, sandboxes, compiled
output, Vitest's file order cache) change which tests the next run selects,
and the workload digest reads `changed` on a tree nobody edited.
