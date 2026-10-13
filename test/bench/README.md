# @systemfsoftware/stryker-bench

The report-only A/B bench lane's orchestrator. The `bench` workflow runs on
every push to main (and on `workflow_dispatch`), never on a pull request. Its
plan job (`pnpm --filter @systemfsoftware/stryker-bench plan`, `src/plan.ts`)
picks side A and the legs. On a push, side A is the newest main commit whose
push-triggered Bench run concluded `success` and which is an ancestor of the
pushed commit, and a leg runs only when Turbo
(`turbo query affected --packages`) reports affected the package holding its
entry or an engine directory every leg builds (`src/engine-dirs.ts`). The full
corpus runs on a dispatch, when no green ancestor exists (side A is then the
first parent), and when the lane's own inputs changed: the `test/bench`
package, `bench.yml`, `.github/actions/released-tarballs/` or the flake pin.
When no leg is affected, the bench job is skipped and the run is green. The
plan job writes its choice to the step summary, and it fails when the checkout
has uncommitted changes, since Turbo would count them.

The bench job runs one job per selected leg (`BENCH_ENTRY`); each builds side A
and the pushed commit (side B) on the same runner, runs both interleaved over
that entry's workload, and reads every number from each run's own NDJSON.

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
base (side A), that `total` and then each other regressed phase of the leg with its
delta, and root's next action. A phase that regressed under an unchanged `total`
is no regression: the verdict line is a `Bench phase-only slowdown` notice that
says no leg total crossed the regression threshold and names the slower cells.

Both upload steps run on `always()`, so an aborted or failed leg still uploads
its report and run streams. A job GitHub kills at 60 minutes may leave no
`bench-report.json`; its timed-out conclusion is then the only signal. The
`::error` annotation carries the first line of an abort reason; the full reason
is in the report JSON and the step summary.

The `Bench` step reads these variables. Its own `env` in `bench.yml` sets
`BENCH_SIDE_A`, `BENCH_SIDE_B`, `BENCH_TURBO_CACHE_DIR` (the checkout's
`.turbo/cache`, which the `Turbo cache` step restores and both sides' builds
read), `BENCH_BASE_SHA`, `BENCH_HEAD_SHA`, `BENCH_REF`, `BENCH_ENTRY` and
`BENCH_SETUP_TIMINGS`; the job's first step writes `JOB_STARTED_AT` to
`GITHUB_ENV`; the runner sets `RUNNER_TEMP` and `GITHUB_STEP_SUMMARY`. When any
is missing the leg aborts with `environment-incomplete`. That abort writes no
`bench-report.json` and no step summary; its `::error` annotation is the only
signal.

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

The enterprise fixture installs its registry dependencies with
`npm install --before=<that side's last pnpm-lock.yaml commit time>`, so a
release published after the side's lockfile last changed cannot enter either
side.

Every run starts from its side's tree exactly as setup left it. Before each
run the bench restores the project directory to the snapshot it took after
setup, outside `node_modules`: files a run added are removed, changed files
are put back, and the Vitest results cache under `node_modules/.vite` is
deleted. Without that, one run's leftovers (reports, sandboxes, compiled
output, Vitest's file order cache) change which tests the next run selects,
and the workload digest reads `changed` on a tree nobody edited.

Both sides are detached worktrees under `RUNNER_TEMP` (`bench-a`, `bench-b`);
the job's checkout holds only the harness. The bench writes each run's NDJSON
stream and incremental report to `RUNNER_TEMP/bench-runs`. The CLI's own
output under the project directory (its reports and sandboxes) does land
inside the side's tree during a run; the restore before the next run removes
it. Every run executes from one fixed path, `RUNNER_TEMP/bench-run`: the bench
renames the side's tree there, runs, and renames it back, even when the run
fails. Mutant ids and the run's inputs digest hash absolute paths, so without a
shared path the two sides would test the same mutants under different ids, in
a different order. A symlink would not work, because Node resolves it to the
real path. The leg aborts when this breaks:

- `run-path-occupied`: the run path already exists before a move-in;
- `run-path-move-failed`: `RUNNER_TEMP` could not be listed, or the move-in
  rename failed, and the reason carries the OS error; or a side's working
  directory or CLI lies outside its own tree, which is a bench bug in side
  setup;
- `run-path-unrestored`: a tree could not be moved back; the reason carries
  the rename error and, when the run itself failed too, the run's own error.

While a side's tree sits at the run path, its worktree's `.git` file points at
a gitdir entry naming the old path. No git call runs inside a measured run:
the engine spawns git only for `--since`, and the bench passes no `--since`.
