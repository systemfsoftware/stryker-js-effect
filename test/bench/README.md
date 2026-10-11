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
step). A regression is reported, not acted on, and only a leg's `total` decides
one: when it separates past max(3% of side A's median, 10 ms), the verdict line,
the step summary and the JSON report carry `phase-regressed`, the commit and its
parent, that `total` and then each other regressed phase of the leg with its
delta, and root's next action. A phase that regressed under an unchanged `total`
stays a table verdict only.

So that a job killed by that timeout or a cancel still leaves a report, the bench
writes `bench-report.json` provisionally after setup and again after each
finished run: an `aborted` outcome with code `leg-incomplete`, the finished
runs, and the step it was about to start ("3 of 8 runs finished; next step:
run 4 of 8 (side A)"). The final report replaces it. Both upload steps run on
`always()`.

The report heading and the verdict line name the ref (`BENCH_REF`). A manual
`workflow_dispatch` may run on any ref; off `refs/heads/main` a regression's next
action is "dispatched on <ref>: speed evidence only, no revert", and the revert
next action appears only on main.

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

The enterprise fixture installs each registry package at the version its side's
`pnpm-lock.yaml` locks: the fixture's root `package.json` gets one `overrides`
entry per package the lockfile holds at a single version. A package the
lockfile holds at several versions cannot be pinned that way; when any exist,
both `npm install` calls also take `--before=<that side's last pnpm-lock.yaml
commit time>`, so those packages resolve only to releases that existed when the
lockfile last changed. The report's `withheldPins` lists them per side, and the
step summary counts them with the cutoff.

Every run starts from its side's tree exactly as setup left it. Before each
run the bench restores the project directory to the snapshot it took after
setup, outside `node_modules`: files a run added are removed, changed files
are put back, and the Vitest results cache under `node_modules/.vite` is
deleted. Without that, one run's leftovers (reports, sandboxes, compiled
output, Vitest's file order cache) change which tests the next run selects,
and the workload digest reads `changed` on a tree nobody edited.

Both sides are detached worktrees under `RUNNER_TEMP` (`bench-a`, `bench-b`);
the job's checkout holds only the harness, and run output goes to
`RUNNER_TEMP/bench-runs`, never into a side's tree. Every run executes from one
fixed path, `RUNNER_TEMP/bench-run`: the bench renames the side's tree there,
runs, and renames it back, even when the run fails. Mutant ids and the run's
inputs digest hash absolute paths, so without a shared path the two sides
would test the same mutants under different ids, in a different order. If the
run path already exists before a move-in, the leg aborts with
`run-path-occupied`; if a tree cannot be moved back, it aborts with
`run-path-unrestored`. A symlink would not work, because Node resolves it to
the real path.
