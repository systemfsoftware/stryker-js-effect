# @systemfsoftware/stryker-bench

The report-only A/B bench lane's orchestrator. The `bench` workflow runs on
every push to main (and on `workflow_dispatch`), never on a pull request. It
runs one job per corpus entry (`BENCH_ENTRY`); each job builds the pushed
commit's first parent (side A) and the commit itself (side B) on the same
runner, runs both interleaved over that entry's workload, and reads every
number from each run's own NDJSON.

Time is measured, never enforced. The bench has no deadline of its own: GitHub's
60-minute job timeout is the only thing that stops a hung setup or run. The
job's first step records its start (`JOB_STARTED_AT`), and the report shows the
leg's wall time from that mark to the report write next to the 10-minute
target; running over the target never changes the exit code or the verdict
line. A job exits non-zero only when the bench cannot produce a comparison: a
run errors or its stream cannot be read (`failed`), or setup or the
orchestration fails (`aborted`, with `side-setup-failed` naming the side and
step). A regression is reported, not acted on: the verdict line, the step
summary and the JSON report carry `phase-regressed`, the commit and its parent,
each regressed project and phase with its delta, and root's next action.

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

Each entry is bounded so its eight runs stay near the 10-minute leg target: a
repo entry may pin `mutate` line ranges and `testFiles`, and the enterprise
fixture pins `mutate` to four files, the same on both sides. The bound shapes
timing only; it never feeds a verdict.

Every run starts from its side's tree exactly as setup left it. Before each
run the bench restores the project directory to the snapshot it took after
setup, outside `node_modules`: files a run added are removed, changed files
are put back, and the Vitest results cache under `node_modules/.vite` is
deleted. Without that, one run's leftovers (reports, sandboxes, compiled
output, Vitest's file order cache) change which tests the next run selects,
and the workload digest reads `changed` on a tree nobody edited.
