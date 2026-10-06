## 16.0.0

### Major Changes

- Mutation testing is now incremental by default: `incremental` defaults to `true`, so an unchanged mutant whose covering tests are unchanged is re-used instead of re-run. `--full` (aliasing the old `--force`) re-verifies every mutant, ignoring the cache and the persisted dry run. The `verdict` stream event records `incrementalMode` (`incremental` or `full`). A run with no reusable cache falls back to a full run as before.

- The incremental report and its checkpoints now record a `costs` entry for every mutant: the predicted milliseconds from the measured dry-run times of its covering tests plus the run's fixed overhead, the wall time of its last executed run, and its covering-test count. A verdict reused from an earlier run carries its recorded `actualMs` forward instead of losing it. The incremental cache layout moves to version `3`, so a report written by an earlier release is discarded rather than reused.

- A mutation run now starts only on main CI. The `run` command, the programmatic run entry point, and every other surface that begins a mutation run refuse to start unless the process runs under GitHub Actions (`GITHUB_ACTIONS=true`); anything else — a developer machine, a fork, or another CI — exits non-zero instead of running mutants. A refused run ends the machine-readable output with a new `refused` event whose `rule` is `mutation-runs-on-main-ci`, and the machine-stream schema version is now `3.0`. Dry runs (`--dryRunOnly`), `--version`, and config and help commands are unaffected.

- The old report-merge command becomes `merge`, which now reads the shard plan and the per-shard report directories and combines them into one mutation report and a per-project incremental report. A merge fails, naming the mutants, when a planned mutant is missing from its shard report or reported by two shards. A new shard mode runs exactly the mutants of one shard, spawning a child run per project the shard lists, so a plan can be executed across parallel jobs and merged afterwards; mutants outside a shard are neither run nor reported.

- The TypeScript checker now applies Trivial Compiler Equivalence (Papadakis et al., ICSE 2015). Each mutant of a file is emitted to JavaScript from the project's own TypeScript configuration in transpile-only mode, normalized, and compared with the original file's emit and with the mutants already emitted at the same site. A mutant whose emit equals the original's is dropped as `Ignored` with reason `equivalent-to-original: tce`; one that equals an earlier same-site mutant's is dropped with `duplicate-at-site: tce`; every mutant whose emit differs is kept, so the check never removes a mutant that changes the program. Checkers gain an `ignored` result variant carrying the suppression reason, and a run publishes the new `tce` machine-stream event with the `equivalentToOriginal` and `duplicateAtSite` counts. Verdict semantics move to version 3.

- Every mutation and incremental run now records a `budget` of predicted and actual seconds on its machine verdict line and in its mutation and incremental reports, derived from the measured cost of the mutants it scheduled and the wall time the run took. `stryker gate` takes `--budget-baseline <file>`, an optional `--budget-tolerance` (default 0.25), and `--update-budget-baseline`; it fails with exit 1 when the finished run's actual seconds exceed the committed baseline by more than the tolerance, naming both numbers, and rewrites the baseline with the current run when updating.

### Minor Changes

- A new `stryker plan` subcommand discovers each project's mutants without running tests, decides reuse against that project's incremental report, costs every scheduled mutant, and packs them into deterministically LPT-scheduled shards. It takes `--target-seconds`, optional `--max-shards`, `--projects`, `--out`, and `--full`, writes a `ShardPlan`, and emits a `plan` stream event.

- Every test-runner and checker process boot now publishes a `worker` line on the machine stream carrying its role, boot ordinal and measured start-up time, so the once-per-worker start-up cost is observable instead of hidden behind the first mutant's per-run overhead. The stream schema version is now `6.0`.

### Patch Changes

- The README now has an upgrade note for 13.x users. 14.0.0 made `'default'` the default `mutator.mutantSetPolicy`, so scores graded under 13.x and later releases cover different mutant sets and are not comparable. The note names where each run records its policy, and states that `mutator: { mutantSetPolicy: 'full' }` keeps the 13.x mutant set.

- A cached incremental report that cannot be decoded now names the decode failure in the run log, so a cache written by an older release says which field the reader refused instead of only that the file could not be parsed.

- Repeating an incremental run in a workspace that builds with Turbo now reuses the pending dry-run coverage and the cached verdicts again. A package's `.turbo` task logs are generated by each build and record that build, so they no longer count as project files the run must watch: a rebuild no longer invalidates coverage whose inputs did not change.

- Mutants no test covers are now verified by the configured checkers before they are reported `NoCoverage`. A checker that rejects such a mutant reports it `CompileError`, with the checker's reason, instead of `NoCoverage`; uncovered mutants that pass every checker are still reported `NoCoverage`. Previously the checkers never saw uncovered mutants, so a non-compiling mutant no test reaches counted as an undetected survivor.

- The incremental report and its checkpoints are now written atomically: the bytes go to a temporary file in the same directory and are renamed over the target, so an interrupted or killed run (a job-cap timeout, or a process stopped while the report is being saved) can no longer leave a truncated incremental file behind. A run that finds a cache written this way decodes it and reuses it instead of discarding the whole mutation history. The mutation report, summary, and incremental report that `stryker merge` writes are saved the same way.
