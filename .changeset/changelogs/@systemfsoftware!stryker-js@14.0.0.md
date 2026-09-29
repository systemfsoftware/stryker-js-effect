## 14.0.0

### Major Changes

- The incremental cache now reuses a verdict only when nothing that could change it has changed: the covering tests and every module they import, the run inputs (lockfile and configuration), and the mutant-set policy. Moving code or releasing a new version no longer throws the cache away. Incremental reports written by earlier versions are discarded once.

  A mutant whose covering tests did not run is retried once, then reported as `RuntimeError` with reason `no covering test executed`.

  The new `mutator.mutantSetPolicy` option defaults to `'default'`. Under it, mutants in logging, telemetry, timing, and configuration-default calls, redundant relational variants, and replacements identical to the original are reported as `Ignored` with a named rule instead of being run. Set `mutator.mutantSetPolicy: 'full'` to keep the previous mutant set.

### Minor Changes

- The new `annotate` command prints GitHub workflow annotations at the location of every survivor of the finished report, so a run's survivors show up on the changed lines of a pull request.

- The new `compare` command names every mutant whose status differs between a baseline report and a fresh one, leaving out the mutant ids passed with `--noise`.

- `stryker feedback <id> --useful|--not-useful [--reason <text>]` appends one `feedback` stream line for a surfaced survivor to reports/mutation/feedback.jsonl.

- The new `gate` command fails when a run leaves survivors that are missing from a committed baseline of accepted survivors, lists them with how to accept them, and `--update-baseline` rewrites the baseline from the finished report.

- `stryker mcp` serves the finished mutation report to MCP clients over stdio, with tools `list_survivors`, `show_mutant`, `rerun_mutant`, and `report_usefulness`.

- Serving the Mutation Server Protocol over stdio and sockets lets editors and agents configure, discover, and mutation-test a project through framed JSON-RPC, with one run at a time, a loopback-only default listener, and named errors for an unusable bind.

- Every run now also writes a reproducer for each mutant: a unified diff against the original source, so a verdict can be re-checked locally without hunting for which mutation produced it.

- Naming mutant ids on the run command re-runs exactly those mutants, restricting the mutated files to their ids' files with verdict reuse left on and reporting each selected mutant's status, covering tests, killing test, and reproducer command, while the trace names the new rerun span for that path.

- The new `sarif` reporter writes a SARIF 2.1.0 log beside the JSON report with one result per capped survivor, each carrying its mutant id in `partialFingerprints` so code scanning can track it.

- The new `--since <ref>` option mutates only the lines changed since the merge base with `<ref>`, and falls back to a full run when the Stryker config, a test-runner config, the package manifest, or the lockfile changed.

- The clear-text report adds a `Static mutants:` line with how many mutants are static and their share of the total mutant cost.

- The new `surfacing` option (default `{ perLine: 1, perFile: 7 }`) caps how many survivors are listed per line and per file, while every survivor still counts toward the score.

- With `--incremental`, an unchanged project now skips the initial test run; that run otherwise executes the suite twice to find flaky tests, and a verdict that depends on a flaky test, or any static mutant while a test is flaky, is re-tested instead of reused.

### Patch Changes

- With checkers configured, a mutant is sent to a test runner as soon as its own check group passes instead of waiting for earlier groups, so `mutant` events can arrive out of plan order while the final report keeps plan order.

- Incremental runs no longer hold a test runner while the checkpoint is rewritten after every mutant; the checkpoint is written in the background at most once per second, and an interrupted run still keeps every mutant it finished.

- Fixed a rare hang where a run stopped making progress while a test runner or checker worker waited for a message that had already arrived. The message now always wakes the worker waiting for it.

- Repeating an incremental run with no source change now reuses every verdict in a project that defines no ignore patterns of its own: a run's own reports are no longer treated as changed inputs, and options that cannot change a verdict no longer invalidate reuse — neither the ones that only select which mutants and tests run (a git ref scope, a single mutant id) nor reporting and logging options such as reporters, colors, thresholds, surfacing or log levels.

- A re-tested mutant now runs the test file of its previous killing test first, and mutation reports keep naming the right killing test after tests are added or reordered.

- Incremental runs now reuse verdicts written under a different `incrementalFile`, `incrementalSources`, `tempDirName` or `cleanTempDir`, so a shard can reuse the verdicts another shard recorded for a file that moved between shards.

- Changing only the version in a package manifest that tests import no longer invalidates the incremental verdicts of those tests, so releasing a package keeps its cached mutation results.
