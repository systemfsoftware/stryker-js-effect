# @systemfsoftware/stryker-js

## 17.0.0

### Major Changes

- A mutant's timeout now starts when its first test begins, not when the test runner is asked to run it. With a short `timeoutMS`, a mutant its tests would kill is reported `Killed` instead of `Timeout`, so a slow or busy machine no longer changes the verdict. A mutant whose tests never begin still ends, on the same window that bounds a plugin worker which never accepts its connection.

  If you author a test-runner plugin, `mutantRun` now streams its run: emit `MutantRunStarted` before the runner's first test begins, then `MutantRunSettled` carrying the result.

### Patch Changes

- A merged shard report now records the run budget, so a budget check can read it and `--update-budget-baseline` can bootstrap a baseline from it. Before, every merged report was refused with `the finished mutation report records no budget`. The budget's actual time is the slowest shard: the sum of its projects' run times, because shards run side by side. The predicted time is the plan's largest per-shard prediction. If any project's progress stream holds no verdict, the merged report carries no budget.

## 16.0.1

### Patch Changes

- A shard run keeps going when one of its projects scores under `thresholds.break` over the shard's mutants. It runs the remaining projects, exits 0, and notes that the merged report carries the project verdict. A shard fails only when a project fails for a real reason: another exit code, or no progress stream. Its error names the project, the exit code and the tail of that project's error output.

  Every non-zero exit now says why in human mode. One final stderr line names the exit code, its class (`VerdictFail`, `ConfigError`, `RuntimeError`, `InternalError`) and the failure with its remediation. A rejected survivor check and a refused re-run no longer print it twice.

  A config file that throws while loading now reports the thrown error instead of `Failed to read config`.

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

## 15.0.1

### Patch Changes

- `cleanTempDir` now decides from how the run ended. With the default (`true`), a successful run removes its `.stryker-tmp/sandbox-*` directory and a failed run keeps it; previously every sandbox was kept, so `.stryker-tmp` grew with each run. `cleanTempDir: false` now keeps the sandbox after every run instead of deleting it. `'always'` still removes it after every run.

- A test runner, checker, or reporter process that stops responding no longer hangs the mutation run forever. When such a process does not exit within 5 seconds of being asked to stop, Stryker force-kills it, so the run ends with an error instead of waiting until something kills it from outside.

- A test runner, checker, or reporter process that starts but never accepts its connection no longer hangs the mutation run forever. Stryker gives each plugin worker 30 seconds to accept the connection on `STRYKER_SOCKET`; a worker that misses that window fails the run with a boot error naming its process id, and the process is stopped. The window does not depend on `dryRunTimeoutMinutes`. A worker that has already connected still reconnects after a dropped connection, as before.

## 15.0.0

### Major Changes

- Effect moves to the stable `4.0.0` release, together with the `@effect/*` packages these libraries use. The `4.0.0` release candidates are no longer supported: install `effect` `^4.0.0` next to these packages before upgrading.

  The TypeScript checker and test-runner plugins bundle their own Effect runtime, so they need no change in your project.

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

## 13.1.0

### Minor Changes

- The `stryker` CLI now continues a caller's trace: when `TRACEPARENT` (and optionally `TRACESTATE`) is set in its environment, the `stryker.cli.run` span and everything beneath it join that trace as a child of the carried span, following the OpenTelemetry environment-carrier specification. An absent or malformed `TRACEPARENT` leaves the run on its own root trace, as before.

### Patch Changes

- The packages now depend on `@systemfsoftware/effect-cell-types` 11.

  - Every tagged error now has a one-line message built from its fields, so a failure names the file, mutant, plugin, worker or exit code involved instead of an empty message. The errors' tags, fields and encoded forms are unchanged.

## 13.0.0

### Major Changes

- A child process exit code is the POSIX status domain now: any value accepted as a `ChildExitCode` is an integer in `0..255`, and a value outside that range is refused. The out-of-memory exit codes are a named, exported domain instead of a private list, so classifying a worker exit depends on a declared value rather than a hidden one.

- The engine's file matching, reporter names, CLI command list, ANSI colours, report stream file name and planned-mutant failures are each declared once. `FileMatcher` keeps only its pattern and hidden-file flag: it no longer carries a `matches` method.

  - The removed `RelativeNormalizedFileName` is replaced by the engine's own normalization, and a report's stream file name is the literal the engine writes.
  - `AnsiColor` is the type of the colour codes rather than a schema, and `CliCommandSchema` plus the reporter-name schemas name the command list and the reporter names.
  - A mutant whose computed timeout is not a finite number now fails planning with the `MutantTimeoutNotFinite` failure naming that mutant.

- Exit codes are one value: `Plugin.ExitCode`, an integer between 0 and 255. The machine stream's failure event, the command's run output, and the run conclusion all carry it, and a run conclusion's outcome is the closed set of run-outcome tags rather than free text.

  `Plugin.ExitCodeFromClass` stays the single exit-class to baseline-code mapping; read a code through it instead of writing the number where an exit class has to become an exit code.

- Mutant ids are decimal index strings. Every schema that carried a mutant id as a plain string now decodes `Mutant.MutantId` and refuses anything else: the mutation report and its mutant results, reporter events (`mutationTestingPlanReady` plans, `mutantTested`), the machine run stream (`mutant` and `verdict`), the survivors prior report, and the mutant coverage keys produced by test runners.

  Mutant ids are minted only as the mutant's canonical non-negative decimal index (`Mutant.MutantId`), including in the instrumenter's planned mutants, placement sites, and checker answers. Consume the new `Mutant.MutantId` schema instead of assuming an arbitrary non-empty string; ids such as `constructor` or `__proto__` no longer decode.

- A mutant's status is declared once, as the eight-value `Mutant.MutantStatus`, plus the named subsets a run partitions on: `Mutant.SurvivorStatus`, `Mutant.RememberedStatus`, `Mutant.EphemeralStatus`, and `Mutant.ActionableStatus`. Import the subset your decision matches instead of re-listing the statuses you accept.

  Mutants are tagged structs now. A status reason decodes only together with a status, and the remembered-mutant and ignored-mutant rows carry the same narrowed status as the subset they were selected by.

- The CLI no longer checks the Node version at startup or prints an `UnsupportedNodeVersion` message. `engines.node` (`>=24.13.1`) is the only statement of support: on an older Node the CLI crashes on the first Node 24 API it calls.

- Human or machine output is declared once, as `OutputMode`, and the reason for that choice once, as `ModeSignal`. The run stream's start and verdict events, the resolved configuration environment, and the machine framer all decode those two schemas.

  A caller that spelled a mode as a plain string union imports the schema's type instead; the duplicate literal lists are gone.

- A plugin load failure is one tagged union. The machine stream's failure event now carries that union — the missing peer, the unsupported peer version, the unrecognized peer, the invalid contribution, or the import that failed — instead of a bare tag string, and a framework refusal's reason is the shared peer-failure subset of the same vocabulary.

  A consumer that compared the failure reason to a string reads the union's tag or its fields instead.

- A report-relative file name is one normalized value again: the canonical file-name brand whose decoder folds backslashes to forward slashes. The separate report file-name brands are gone, and the mutation report and mutation part names are schemas a consumer reads rather than strings it repeats.

- The machine stream's tested-mutant event is one declaration now. `RunEvent.RunMutantTested` is a codec whose type is `Reporter.MutantTested` and whose encoded form is the stream's `{"_tag":"mutant"}` line, so the stream carries the domain event and the boundary renames its tag and fields. The emitted stdout bytes and their order are unchanged.

  Two published names moved with it: `RunEvent.RunMutantTested` no longer constructs (`RunMutantTested.make` is gone; build a `Reporter.MutantTested` instead), and `RunEvent.MetricsResultFromReport.fromFiles` is replaced by the function `RunEvent.metricsResultFromFiles`.

- Source locations are 1-based and validated end to end. `Mutant.Location`, `Mutant.Position`, `Mutant.Span`, `Mutant.OpenEndLocation`, `Mutant.ScriptOrigin`, and `Mutant.LineStarts` replace the former `LocationSchema`, `PositionSchema`, and `OpenEndLocationSchema`; a location whose end precedes its start, or a line or column below 1, no longer decodes.

  - A mutant location always speaks the report contract, so a producer that minted 0-based coordinates or a bare number must switch to the new schemas.
  - An embedded script's origin is a `ScriptOrigin` (1-based line plus a column shift), not a position.
  - Incremental state from releases that stored the earlier column base is no longer matched: those mutants are re-tested, not reused, while the run rewrites the state.

- Test identifiers are one value: `TestRunner.TestId`, a non-empty branded string carrying the runner's `file#test name` form. Test runner results, report test definitions, a mutant's killers and coverers, per-test hit records, and the test-contribution evaluation all speak that one type instead of bare strings.

  Mint one with `TestRunner.TestId.make(...)` where a runner derives a test id; the machine stream and mutation report schemas brand the ids they decode.

- Mutation score thresholds are declared once, as `Report.ThresholdsSchema`: `high`, `low`, and a `break` that is null when no breaking threshold is configured. The option file and the mutation report decode the same schema, and a pair whose `low` is above its `high` is refused with "a mutation score threshold pair has low at or below high".

  The mutation report's thresholds now include `break`, so a consumer reads the breaking threshold from the report instead of recovering it from the embedded reporter configuration.

### Patch Changes

- The TypeScript checker describes a tsconfig document through the schema that declares the keys it interprets, so an override round-trips the document it was given, and the mutant it cannot describe to a checker carries the canonical file-name brand. The plugin contract, configurations, reports, and exit codes are unchanged.

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.

- A mutant whose test run exceeds the wall-clock timeout is now reported as `Timeout` (reason `wall-clock-timeout`) and the run continues with the remaining mutants. The hung test-runner worker is killed and replaced instead of aborting the whole run with exit code 4.

- Updated dependencies:
  - @systemfsoftware/stryker-js-vitest-runner@8.0.0

## 12.1.1

### Patch Changes

- The `stryker.cli.run` trace span now records the failure text in its `stryker.run.error` attribute for every failed run. It was empty unless the run was interrupted, so a failed dry run, a failing checker, or a rejected argument left no reason in the exported trace.

## 12.1.0

### Minor Changes

- A piped `stdout` now gets human output, exactly like a terminal. Machine consumers ask for the NDJSON event stream explicitly, with `--json` or `STRYKER_MODE=machine`; `--format text` names the human format, and passing it together with `--json` is a usage error (exit 2). Under `--json`, `stdout` carries wire records and nothing else, while progress status lines and log output stay on `stderr`.

  Every run also writes those wire records to `reports/mutation-stream.jsonl` in human mode too, so a job that shows a readable log still produces the artifact `stryker merge-reports` rebuilds a shard's report from.

  If a script or CI step read NDJSON from a piped run without requesting it, pass `--json` (or set `STRYKER_MODE=machine`) there.

  Custom `RunEventDrain` implementations must accept a required `toStdout` argument in `drainFramed`; pass-throughs can ignore it.

### Patch Changes

- A run whose selected files produce no mutants, for example because no loaded framework claims them, now runs every test in the dry run and finishes with an empty report. With `testRunner: 'vm'` or `'vitest'` it used to fail with "No tests were executed", because the dry run only looked for tests related to those files. The dry run now relates tests only to the files that carry mutants.

- A run whose `mutate` patterns match no file now finishes successfully instead of stopping with an instrument error. It performs the dry run, writes a mutation report with no files, and passes regardless of `thresholds.break`, the same as upstream StrykerJS. A sharded run whose shard receives no file no longer fails.

  `stryker merge-reports` shows `n/a` for a package whose report has no tested mutant, instead of a score of `0.00`.

  Errors reported for the prepare, dry-run, and mutation-testing stages now carry their reason as the error message, so a printed cause no longer shows up as a bare error name.

- `stryker merge-reports` now rebuilds a package's partial report from the mutants recorded in its stream part when the run ended before writing its final report. Earlier versions recognized none of the recorded mutants and reported the package as having no report.

- Mutation runs with `testRunner: 'vm'` finish in about half the time, with the same verdicts. The engine checks mutant groups on every checker process at once, stops the checkers as soon as checking ends, hands their share of `concurrency` to the test runners, and shares a Node compile cache with every worker it starts. The Vitest runner starts the next isolated worker thread while the current test file runs, so each file still gets a fresh thread but no longer waits for one to boot. On a 319-mutant TypeScript project with the TypeScript checker, a run went from 24.9 s to 12.6 s.

- `testRunner: 'vm'` runs Vitest itself on Vitest's isolated `threads` pool instead of an in-process reimplementation, and stays the default `testRunner`. It reports the same test ids, outcomes and per-mutant verdicts as `testRunner: 'vitest'`, so a project whose Vitest config enables browser mode is refused at startup with a message naming `testRunner: 'vitest'`.

  Stryker no longer discovers test files for `vm`: Vitest selects them from your config, as it does for `testRunner: 'vitest'`. A run that loads no test files fails the dry run naming `testFiles`.

## 12.0.0

### Major Changes

- Restore `defineConfig` and `mergeConfig` on `@systemfsoftware/stryker-js/config`. `defineConfig` accepts an options object, a promise of one, or a `(env: ConfigEnv) => …` factory, as in 10.1.1, and `mergeConfig(defaults, overrides)` composes presets again. `StrykerConfig` is again the partial-options type, so `const config: StrykerConfig = defineConfig({ … })` typechecks. Config files written against the 10.1.1 `./config` surface load and typecheck without edits.

  This removes the 11.0.0 `StrykerConfig` class value. If you adopted it:

  - Replace `StrykerConfig.define(…)` with `defineConfig(…)` and `StrykerConfig.merge(…)` with `mergeConfig(…)`, imported from `@systemfsoftware/stryker-js/config`.
  - Replace `StrykerConfig.createDefaultOptions()` and `StrykerConfig.defaultOptions` with `Configuration.createDefaultOptions()` and `Configuration.defaultOptions` from the package entry point.

### Patch Changes

- A failed dry run now says which tests broke and why. The refusal names every failing test with its failure message in the error output and in the log at the default level, instead of reporting only how many failed.

- Installing `@systemfsoftware/stryker-js` on its own now works. `effect` was declared an optional peer even though Stryker imports it at runtime. Package managers never install optional peers, so a project without `effect` failed with `Failed to read config` before the run started. `effect` is now a required peer: pnpm and npm install it automatically, and a project that already uses Effect shares its own copy with Stryker.

- The packages now build on the latest `@systemfsoftware/effect-cell-types` 10.2 cell kinds, with no change to their published behavior.

  - `@systemfsoftware/stryker-test-contribution` exports its evaluator as `Judge`, `TestContribution`, and `TestContributionEvaluator`, and now depends on `effect` directly.

## 11.0.0

### Patch Changes

- A mutation run no longer stalls forever when a checker or test-runner worker stops answering its connection. Previously a request that was in flight when the worker's connection dropped kept waiting on the dead connection, freezing progress until the CI timeout killed the run. Such a request now fails with a typed connection error when its connection drops, and the worker is restarted per the existing crash policy. Only requests already sent on the dropped connection fail: the client still reconnects on its own, and requests made while it reconnects, including the first request to a worker that is still booting, wait for the connection instead of failing.

## 10.2.0

### Minor Changes

- Three opt-in mutators plant Effect concurrency faults on top of the default set, so a mutation run can check that your concurrency tests catch races. `AtomicUpdateSplit` splits read-modify-write calls on `Ref` and `SynchronizedRef` into a separate read, a yield, and a separate write. `SynchronizationRemoval` removes semaphore permits, `Effect.uninterruptible`, and `Effect.uninterruptibleMask`. `FinalizerEscape` stops `ensuring`, `onExit`, `onError`, `onInterrupt`, `acquireRelease`, and `acquireUseRelease` cleanup from running on interruption. All three are off by default. Enable any subset by listing them under `mutator: { optInMutations: [...] }` in your configuration. A name that is not an opt-in mutator fails the run, and the error lists the known names. The replacements use Effect 4 APIs, so a repository on Effect 3.x must not opt in.

## 10.1.2

### Patch Changes

- `@systemfsoftware/stryker-vm-harness` is the in-memory V8 VM test-runner harness that powers `testRunner: 'vm'`. `@systemfsoftware/stryker-js` now depends on it.

- The in-memory V8 VM runner (`testRunner: 'vm'`) now executes suites written for `vitest`, `@effect/vitest`, and `@systemfsoftware/effect-gherkin-spec` out of the box: the usual test surface — `describe`/`it`, `.skip`, `.only`, `.todo`, `.each`, `it.fails`, and hooks — behaves as it does under vitest, and each test is reported on its own with its real failure message instead of one all-tests result. Mutant runs attribute a kill to the exact test that caught the change. A suite that never finishes yields a timeout result instead of hanging the run, unhandled rejections are captured in the run report, module state is fresh on every run, and a suite that cannot compile still fails the run with a typed failure naming the file.

## 10.1.1

### Patch Changes

- Exported declarations that previously took `unknown` now take a defaulted type parameter: calls that omit the type argument are unchanged, and calls that were previously rejected for passing an unconstrained value are accepted. No runtime behaviour changes.

## 10.1.0

### Minor Changes

- A finite mutant is killed or survived from its tests. Timeout is reserved for one named nonterminating trap, detected by a hit bound rather than a wall-clock budget. A wall-clock timeout fails the run instead of being stored as a detected mutant.

## 10.0.1

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

## 10.0.0

### Major Changes

- The machine-mode event stream now tags every event document with `_tag` (previously `kind`), matching the `RunEvent` schema tags. The wire line schema `RunEventWireLine` is exported, so consumers can decode machine-mode stdout lines with the same schema the CLI encodes them with. The event stream's composition surface is now public: `makeRunEventStream`, `RunEventStream`, `RunEventDrain`, `RunEventDrainLive`, and `ResolvedModeInput`.

  Consumers parsing machine-mode stdout must read the `_tag` field instead of `kind`.

### Patch Changes

- A checker that fails now fails mutation testing with that checker's cause, instead of crashing with an empty error. The TypeScript checker type-checks each mutant, so compile errors appear in the report. Verdict counts are non-negative integers; `Metrics` is a class you can build from mutant statuses; a threshold `low` may not exceed `high`.

## 9.0.0

### Major Changes

- The incremental file now carries `incrementalVersion` (the Stryker package version). Stryker writes it on every incremental run and discards an incremental file it cannot parse or whose `incrementalVersion` differs from the running version, falling back to a full mutation testing run instead of failing. `IncrementalReportSchema` requires `incrementalVersion`, and `decodeIncrementalReport` and `IncrementalReportError` are no longer exported.

## 8.0.0

### Major Changes

- The checker request carries a plain data record, not the instrumenter's `Mutant` class. `CheckerRequest.mutants` and `CheckerService.check`/`group` now speak `CheckerMutantWire` - `id`, `fileName`, `mutatorName`, `replacement`, and `location`. A mutant that cannot be described to a checker is skipped instead of reaching it.

  With `OTEL_ENABLED=true` the CLI now exports its OpenTelemetry metrics to `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_METRIC_EXPORT_INTERVAL` sets the export interval in milliseconds. Checker timings, mutant counts, and worker crashes now reach a metrics backend.

  `ConfigEnv` and `resolveExtends` are no longer exported. Import `ConfigEnv` from the config entry point of the package, and read merged options with `loadConfigCell` or `readConfig` from the package root - either performs the `extends` walk, validation and merge in order.

## 7.0.0

### Major Changes

- The built-in reporters, plugin loading and their types are no longer published
  from separate entry points on `@systemfsoftware/stryker-js`; import them from
  `@systemfsoftware/stryker-js`. The mutant vocabulary — `Mutant`, `Location`,
  `Position` and their schemas — is importable only from
  `@systemfsoftware/stryker-js-instrumenter`.

## 6.1.0

### Minor Changes

- Types that appear on the published CLI and instrumenter APIs are now exported.

### Patch Changes

- Installing the CLI no longer nests the HTML reporter, plugin-interface, plugin-runtime, instrumenter, or ignorer-interface packages. The CLI still includes the HTML reporter. Those packages remain installable on their own.

- Installing the CLI no longer depends on minimatch. mutate and ignorePatterns still accept the same glob syntax.

## 6.0.0

### Major Changes

- `testRunner`, `checkers`, and `ignorers` now carry the plugin and its options together.

  - `testRunner` is `'command'`, `'vm'`, or `{ plugin, options?, nodeArgs? }`.
  - `checkers` is `{ plugin, options?, nodeArgs? }[]`. Each checker is its own plugin.
  - `ignorers` is plugin file URLs. Every ignorer those modules export runs. There is no separate name list.
  - Put Vitest settings on `testRunner.options` (`configFile`, `dir`, `related`). There is no `vitest` block.
  - Put TypeScript checker settings on that checker's `options` (`prioritizePerformanceOverAccuracy`). There is no `typescriptChecker` block.

  Before:

  ```ts
  export default defineConfig({
    testRunner: 'vitest',
    checkers: ['typescript'],
    plugins: [
      import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
      import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
      import.meta.resolve('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    ],
    vitest: { configFile: 'vitest.config.ts' },
    typescriptChecker: { prioritizePerformanceOverAccuracy: true },
    ignorers: ['effect-schema-declarations'],
  })
  ```

  After:

  ```ts
  export default defineConfig({
    testRunner: {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
      options: { configFile: 'vitest.config.ts' },
    },
    checkers: [
      {
        plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
        options: { prioritizePerformanceOverAccuracy: true },
      },
    ],
    ignorers: [
      import.meta.resolve('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    ],
  })
  ```

### Patch Changes

- Unix worker sockets are now owner-read-write once the worker has bound them. Named pipes are unchanged.

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@6.0.0

## 5.0.0

### Major Changes

- Plugin entries in `plugins` and `appendPlugins` are now the entrypoints
  themselves, as `file:` URLs, instead of package names Stryker resolved for you.

  Stryker resolved every specifier against its own module before, so a plugin the
  project had installed was only found when Node happened to walk to the right
  `node_modules` from Stryker's location — which is not the project's location for
  a global install, an `npx` run, or a strict isolated store. The project now
  resolves each plugin itself, in the config module where the project's own
  dependencies are visible:

  ```ts
  import { defineConfig } from '@systemfsoftware/stryker-js/config'

  export default defineConfig({
    plugins: [import.meta.resolve('@acme/stryker-runner')],
  })
  ```

  The `--plugins` and `--appendPlugins` flags take the same resolved URLs. A value
  that is not a `file:` URL is refused with the entry named.

  Stryker no longer reports an unresolved specifier as a warning it can continue
  past, because it no longer resolves one: a plugin that cannot be loaded stops
  the run and names the entry, and a plugin that loads but contributes nothing is
  still reported as before.

- The engine and the CLI are one package. `@systemfsoftware/stryker-js` now ships
  the `stryker` binary, the run engine, and the configuration surface, replacing
  `@systemfsoftware/stryker-js-cli` and `@systemfsoftware/stryker-js-engine`, which
  are discontinued.

  Two subpaths are new:

  - `./config` — `defineConfig`, `mergeConfig`, `ConfigEnv`, `StrykerConfig`. Use it
    instead of hand-typing `stryker.config.ts` against the option type.
  - `./promises` — `run`, the same run interpreted for promise callers, so an
    embedding script does not need an Effect runtime.

  Migrate by importing from `@systemfsoftware/stryker-js`. Everything the two
  discontinued packages exported — the option type, `readConfig`, the plugin
  loader, `WorkerLauncher`, and the exit classification — keeps its name and its
  behavior at the new address.

  `@systemfsoftware/stryker-js-language` is gone; it is replaced rather than
  continued. The run-event vocabulary it was carrying — `RunEvents`, `RunIdentity`,
  `RunPhase`, and the `Run*` event schemas — now ships from
  `@systemfsoftware/stryker-js`. Two consequences follow for anyone who imported
  it:

  - The mutant model, the report schemas, and the checker, evaluator and
    test-runner contracts come from `@systemfsoftware/stryker-js-instrumenter`
    and `@systemfsoftware/stryker-js-plugin-interface`. Update those imports.
  - The service identifiers `@systemfsoftware/stryker-js-language/RunEvents` and
    `@systemfsoftware/stryker-js-language/RunIdentity` are now
    `@systemfsoftware/stryker-js/RunEvents` and
    `@systemfsoftware/stryker-js/RunEvents/RunIdentity`. A program that provides or
    looks up either service by its identifier string must use the new one.

  Two more changes reach programmatic callers:

  - `testRunner: 'vm'` runs the test suite in memory. Stryker strips TypeScript from
    the test files during preparation and evaluates them in a fresh V8 context per
    mutant, so a run needs no child process and no manual bundling.
  - `readConfig` and `resolveExtends` take the invocation a configuration is being
    read for, so a `stryker.config.ts` may export a factory receiving
    `{ command, isDryRun, mode, isCi }` and compute its settings per invocation.
    Both keep working for a plain exported object; the extra argument is the
    `command` and output `mode` the loader cannot see for itself.

## 4.0.0

### Major Changes

- The machine-stream event class `MutantTested` (tag `mutant`) is renamed `RunMutantTested`.

  The reporter-protocol event class keeps the name `MutantTested`; the two classes described different events under one name. Serialized stream output is unchanged — the rename is the exported binding only. If you constructed or matched the machine-stream class, import `RunMutantTested` from `@systemfsoftware/stryker-js/Run`.

- Removed the unused `output-file` and `provided-options` entry points — neither carried vocabulary the rest of the package does not already provide.

  If you imported `output-file`, write the directory and file through your own filesystem service. If you imported the `ProvidedStrykerOptions` alias, use `StrykerOptions` from `@systemfsoftware/stryker-js/Schema` instead.

- All subpath entry points are removed; the package exports one root specifier that enumerates every published symbol exactly once.

  `@systemfsoftware/stryker-js/Checker`, `/Schema`, `/Run`, and every other concept specifier are gone. Import the same symbols from `@systemfsoftware/stryker-js` directly. Two names changed while the vocabulary merged into one surface:

  - the machine-stream result type `MutantResult` is now `RunMutantResult` (the serialized report shape keeps the name `MutantResult`);
  - the reporter barrel `./Reporter` merged into `ReporterEvent`: `ReporterFailed` now lives beside the event classes, and the unused `REPORTER_SCHEMA_VERSION` constant is deleted.

  Duplicate publications of `MutantStatus`, `Position`, `Location`, and their schema values now resolve to the report-format home, so every symbol has exactly one import path.

### Patch Changes

- The recommended oxlint set now carries `workflow-variant-constructed` and `runtime-construction-placement` at `error`, and the make-keyed workflow rules recognize the `Workflow.total` and `Workflow.andThen` constructors as lawful workflow construction.

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@8.0.0

## 3.0.2

### Patch Changes

- Releases the workspace so its published versions track the shared dependency graph this change moves.

- The `@systemfsoftware/source` export condition is gone. It resolved to a package's TypeScript sources for editors and in-repo typechecks; each package now exports only its built entry. If your tsconfig sets `customConditions: ["@systemfsoftware/source"]`, or a bundler config names that condition, remove it — resolution falls back to the built entry, which is what every consumer already got.

## 3.0.1

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@7.0.0

## 3.0.0

### Major Changes

- Reporter plugins are now pull-stream consumers: a reporter exports a factory
  that returns an async consumer of the four run events, instead of registering
  an Effect layer that provides the `Reporter` capability service.

  - Removed: `ReporterService`, `broadcastReporter`, `NamedReporter`, the
    `Reporter` service class, and the legacy event payload types.
  - The event protocol ships as a Standard Schema object; validate and infer it
    with `import { ReporterEventSchema, type ReporterFactory, type ReporterInit }
    from '@systemfsoftware/stryker-js/ReporterEvent'`.
  - Event payloads are narrowed: the dry-run event no longer carries the coverage
    map; the plan event carries reduced mutant descriptors instead of full run
    options; `mutantTested` drops `killedBy`, `coveredBy`, `static`,
    `testsCompleted` and `statusReason`, and renames `mutatorName` to `mutator`.
  - `ReporterFailed.event` now names the event kind being processed instead of a
    lifecycle method name; `'wrapUp'` no longer occurs.
  - An unknown reporter name now fails the run at startup instead of being
    silently ignored. A reporter that fails on the terminal report now fails the
    run; a reporter that fails earlier is logged and detached with the exit code
    unchanged.
  - `@systemfsoftware/stryker-js-engine/builtin-reporters` no longer exports
    `strykerPlugins`; call `makeBuiltinReporterFactories({ fileSystem, path })`.
  - The built-in json and clear-text reporters write their notices directly to
    stdout and stderr instead of the Effect logger, and the html reporter no
    longer depends on `@effect/platform-node`.

- Remove the --llms command manifest: the CLI no longer accepts --llms and the Run stream no longer carries a manifest terminal event.

## 2.0.0

### Major Changes

- The packages are renamed. `plugin-api` is now `@systemfsoftware/stryker-js`, the
  language every plugin is written against. `mutation-run` is split: the run
  itself is `@systemfsoftware/stryker-js-engine`
  (host-neutral, no Node on its manifest) and the Node process entries are
  `@systemfsoftware/stryker-js-cli`, which owns the worker files and the runtime
  gate. `mutation-report` is now `@systemfsoftware/stryker-js-html-reporter`.
  `@systemfsoftware/stryker-js-platform-node` is never published — do not install
  it. Install the new names and change your imports.

  Options types moved. `StrykerOptions`, `PartialStrykerOptions` and `LogLevel` are
  imported from the `Schema` export; `Mutant`, `MutantStatus`, `Position` and
  `Location` from the `Mutant` export. Point a config's `extends` at the language
  package's `Schema` export.

  `MutantStatus` accepts one spelling per outcome: `Killed`, `Survived`,
  `NoCoverage`, `Timeout`, `CompileError`, `RuntimeError`, `Ignored` and `Pending`.
  The lowercase and abbreviated forms — `killed`, `timedOut`, `noCoverage` and the
  rest — are gone. A comparison against a removed spelling never matched the value
  the reporter actually produced, so check any status comparison you wrote.

  Statuses, plugin kinds, exit classes and AST formats are string literal unions
  rather than enums, so read them as their string values. Member access such as
  `ExitClass.VerdictFail` no longer resolves.

  A plugin no longer receives a logger, and the logger port is gone. Plugins log
  through Effect, and the host decides where that output goes.

  The bundled base preset is gone. A config inherits from the language package's
  `Schema` export and states the thresholds, reporters and plugins it wants; you no
  longer silently inherit a package manager, a plugin list or a break threshold.

- An evaluator now answers with the verdict it reached instead of failing to
  report one.

  `Evaluator.evaluate` returns `ExitClass | null` on the success channel: the
  class the run should end in, or `null` for nothing to report. `ExitClass` is
  exported from `@systemfsoftware/stryker-js/evaluate`. The error
  channel is for the evaluator itself breaking — a report it cannot read, a
  decision it cannot reach.

  Previously the only way to report a failed gate was to fail, which a caller
  could not tell apart from the evaluator crashing, so neither the exit code nor
  the message could distinguish them. If you wrote an evaluator that failed to
  signal a verdict, return the class instead.

  A run's verdict is now the most severe class anyone reported — the score against
  your `break` threshold, plus every evaluator's answer.

- Plugins are written against Effect instead of Promise.

  `Checker`, `TestRunner`, `Reporter`, `Ignorer` and `Evaluator` are capability services whose operations return an `Effect`. Provide your plugin as a `Layer` through `declarePlugin`; the class, factory and value declarations are gone, along with the `typed-inject` dependency. Implement the operations that were optional — return `Effect.void` where there is nothing to do, and one group per mutant from `group` if you have no grouping opinion.

  Each capability fails with a tagged error. Outcomes are not failures: a killed mutant, a survivor and a compile error in the code under test are successful results.

  Read the sandbox path from `SandboxDirectory`. `commonTokens`, `tokens` and the plugin context types are removed. `determineHitLimitReached` returns an `Option`.

### Minor Changes

- `RENDERED_OPTION_DEFAULTS` is exported from the `core` entry point. It carries
  the four option defaults that appear in human-readable help text, so a tool
  printing "the default is X" reads the same value the option schema applies
  instead of restating it.

- The shared helpers package is gone. Nothing installs it any more, and the
  handful of helpers worth sharing now live in the plugin contract next to the
  types they serve:

  - `strykerReportBugUrl`, `normalizeFileName`, `propertyPath`, `errorToString`
    and `isErrnoException` from `@systemfsoftware/stryker-js/core`
  - `noopLogger` from `@systemfsoftware/stryker-js/logging`
  - `testFilesProvided` from `@systemfsoftware/stryker-js/test-runner`

  If you imported any of those, change the specifier. Everything else it exported
  had no consumer and is removed: use `Predicate.isNotNullish` from Effect in place
  of `notEmpty`, and `RegExp.escape` in place of `escapeRegExp`.

- Checker and test-runner workers now talk over Effect's own worker RPC, and every
  call they exchange is a declared operation with a declared result.

  Before, the parent and its workers spoke a protocol written by hand: messages were
  newline-delimited JSON, arguments were typed as "any JSON value", and each method
  was reached by name through a proxy. Nothing checked that a payload was one the far
  end could serve, so a value it could not read was refused after it arrived, and a
  call whose message never landed was waited on anyway.

  The six operations that cross that boundary — a checker's `check` and `group`, a
  runner's `capabilities`, `dryRun` and `mutantRun` — now each name what they take
  and what they return, and the options a worker starts from are sent once when it
  starts rather than as a first method call. A payload that does not fit is refused
  where it is built, and a worker that cannot answer fails the call that was waiting.

  The two worker entry points are no longer importable subpaths of this package.
  They were only ever spawned as processes, and the paths resolved to TypeScript
  sources that could not be executed.

### Patch Changes

- A mutation run that is killed mid-way keeps every completed mutant: the JSONL progress stream is flushed after each result, and incremental mode writes remembered verdicts as they finish so the next run continues instead of starting over.

  Remembered killed mutants still name the tests that killed them, so a resumed run's report matches a complete run.

  The progress stream path is progressStreamFile (default reports/mutation-stream.jsonl) and can be set in config or with --progressStreamFile.

- New version is published through npm trusted publishing, so it carries a provenance attestation you can verify.

- Peer Effect requirement advances to 4.0.0-rc.112. No API changes.

- An oversized message between the runner and a worker now fails the run with a
  reason instead of exhausting memory. Each side of the connection reads frames
  up to 16 MiB, which leaves headroom over the largest legitimate payload — a dry
  run carrying per-test coverage — and a frame past the limit fails the calls
  waiting on it rather than growing until the process dies.

- Each of these packages now has a README, so its registry page says what the package is, how
  to install it, and what to import or register — previously the page was blank. The lint
  plugins show the configuration line that enables what they recommend.

  `@systemfsoftware/stryker-js-html-reporter` also carries its licence text

- These packages no longer install dependencies they never imported, so installing them pulls less into your tree.

  `tslib` is gone from all six. The mutation runner additionally stops installing `lodash.groupby`, `semver` and `source-map`, and the command line interface stops installing `@effect/platform-node-shared`. Nothing exported changes.

- Published packages no longer carry build artifacts left over from earlier builds. One package was shipping about a megabyte of bundled test-runner internals this way.

- The closing verdict line carries its findings again. It had shrunk to the score alone, so a consumer reading the stream could no longer see the score limits the run was held to, where the report was written, or which mutants survived — the survivors were reported while the run was in flight and then absent from the summary that closes it.

  The verdict now states the thresholds, the report path, and every surviving mutant with its file, position, mutator and replacement.

## 1.0.0

### Major Changes

- The console log threshold is now scoped to the run that set it. Two runs in one
  process no longer share it, so a run that lowers its own level can no longer
  quieten another run happening alongside it.

  `setEngineLogLevel` is removed. The level travels with the run.

- `runMutationTest` now requires the run-identity services to be provided by the caller; the effect names them in its requirements channel.

- The public Run subpath's shouldKeepTempDir now accepts any failure channel instead of only S.SchemaError; the runMutationTest signature and event surface are unchanged

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@6.0.0

## 0.2.0

### Minor Changes

- Plugin code can now ask for the module-loader service instead of touching the host module API: it exposes the same `createRequire`/`isBuiltin` surface as the host module module, and the Node engine supplies it automatically. Plugins that declare their environment through the engine's plugin declaration get the service without extra wiring; upgrades should move the engine and its plugins in the same release.

### Patch Changes

- Refreshed builds on the platform-services dependency graph; the packages no longer reach for host builtins directly. No CLI flags or option names change.

## 0.1.1

### Patch Changes

- Re-published against the oxc-based instrumenter: workspace dependency ranges move to the new instrumenter major; no package's own behavior changes in this release.

## 0.1.0

### Major Changes

- Three packages are renamed. `plugin-api` is now `@systemfsoftware/stryker-js`, the
  language every plugin is written against. `mutation-run` is now
  `@systemfsoftware/stryker-js-platform-node`, the Node host that runs a mutation
  test. `mutation-report` is now `@systemfsoftware/stryker-js-html-reporter`.
  Install the new names and change your imports.

  Options types moved. `StrykerOptions`, `PartialStrykerOptions` and `LogLevel` are
  imported from the `Schema` export; `Mutant`, `MutantStatus`, `Position` and
  `Location` from the `Mutant` export. Point a config's `extends` at the language
  package's `Schema` export.

  `MutantStatus` accepts one spelling per outcome: `Killed`, `Survived`,
  `NoCoverage`, `Timeout`, `CompileError`, `RuntimeError`, `Ignored` and `Pending`.
  The lowercase and abbreviated forms — `killed`, `timedOut`, `noCoverage` and the
  rest — are gone. A comparison against a removed spelling never matched the value
  the reporter actually produced, so check any status comparison you wrote.

  Statuses, plugin kinds, exit classes and AST formats are string literal unions
  rather than enums, so read them as their string values. Member access such as
  `ExitClass.VerdictFail` no longer resolves.

  A plugin no longer receives a logger, and the logger port is gone. Plugins log
  through Effect, and the host decides where that output goes.

  The bundled base preset is gone. A config inherits from the language package's
  `Schema` export and states the thresholds, reporters and plugins it wants; you no
  longer silently inherit a package manager, a plugin list or a break threshold.

- An evaluator now answers with the verdict it reached instead of failing to
  report one.

  `Evaluator.evaluate` returns `ExitClass | null` on the success channel: the
  class the run should end in, or `null` for nothing to report. `ExitClass` is
  exported from `@systemfsoftware/stryker-js/evaluate`. The error
  channel is for the evaluator itself breaking — a report it cannot read, a
  decision it cannot reach.

  Previously the only way to report a failed gate was to fail, which a caller
  could not tell apart from the evaluator crashing, so neither the exit code nor
  the message could distinguish them. If you wrote an evaluator that failed to
  signal a verdict, return the class instead.

  A run's verdict is now the most severe class anyone reported — the score against
  your `break` threshold, plus every evaluator's answer.

- Plugins are written against Effect instead of Promise.

  `Checker`, `TestRunner`, `Reporter`, `Ignorer` and `Evaluator` are capability services whose operations return an `Effect`. Provide your plugin as a `Layer` through `declarePlugin`; the class, factory and value declarations are gone, along with the `typed-inject` dependency. Implement the operations that were optional — return `Effect.void` where there is nothing to do, and one group per mutant from `group` if you have no grouping opinion.

  Each capability fails with a tagged error. Outcomes are not failures: a killed mutant, a survivor and a compile error in the code under test are successful results.

  Read the sandbox path from `SandboxDirectory`. `commonTokens`, `tokens` and the plugin context types are removed. `determineHitLimitReached` returns an `Option`.

### Minor Changes

- `RENDERED_OPTION_DEFAULTS` is exported from the `core` entry point. It carries
  the four option defaults that appear in human-readable help text, so a tool
  printing "the default is X" reads the same value the option schema applies
  instead of restating it.

- The shared helpers package is gone. Nothing installs it any more, and the
  handful of helpers worth sharing now live in the plugin contract next to the
  types they serve:

  - `strykerReportBugUrl`, `normalizeFileName`, `propertyPath`, `errorToString`
    and `isErrnoException` from `@systemfsoftware/stryker-js/core`
  - `noopLogger` from `@systemfsoftware/stryker-js/logging`
  - `testFilesProvided` from `@systemfsoftware/stryker-js/test-runner`

  If you imported any of those, change the specifier. Everything else it exported
  had no consumer and is removed: use `Predicate.isNotNullish` from Effect in place
  of `notEmpty`, and `RegExp.escape` in place of `escapeRegExp`.

- Checker and test-runner workers now talk over Effect's own worker RPC, and every
  call they exchange is a declared operation with a declared result.

  Before, the parent and its workers spoke a protocol written by hand: messages were
  newline-delimited JSON, arguments were typed as "any JSON value", and each method
  was reached by name through a proxy. Nothing checked that a payload was one the far
  end could serve, so a value it could not read was refused after it arrived, and a
  call whose message never landed was waited on anyway.

  The six operations that cross that boundary — a checker's `check` and `group`, a
  runner's `capabilities`, `dryRun` and `mutantRun` — now each name what they take
  and what they return, and the options a worker starts from are sent once when it
  starts rather than as a first method call. A payload that does not fit is refused
  where it is built, and a worker that cannot answer fails the call that was waiting.

  The two worker entry points are no longer importable subpaths of this package.
  They were only ever spawned as processes, and the paths resolved to TypeScript
  sources that could not be executed.

### Patch Changes

- New version is published through npm trusted publishing, so it carries a provenance attestation you can verify.

- An oversized message between the runner and a worker now fails the run with a
  reason instead of exhausting memory. Each side of the connection reads frames
  up to 16 MiB, which leaves headroom over the largest legitimate payload — a dry
  run carrying per-test coverage — and a frame past the limit fails the calls
  waiting on it rather than growing until the process dies.

- Each of these packages now has a README, so its registry page says what the package is, how
  to install it, and what to import or register — previously the page was blank. The lint
  plugins show the configuration line that enables what they recommend.

  `@systemfsoftware/stryker-js-html-reporter` also carries its licence text

- These packages no longer install dependencies they never imported, so installing them pulls less into your tree.

  `tslib` is gone from all six. The mutation runner additionally stops installing `lodash.groupby`, `semver` and `source-map`, and the command line interface stops installing `@effect/platform-node-shared`. Nothing exported changes.

- Published packages no longer carry build artifacts left over from earlier builds. One package was shipping about a megabyte of bundled test-runner internals this way.

- The closing verdict line carries its findings again. It had shrunk to the score alone, so a consumer reading the stream could no longer see the score limits the run was held to, where the report was written, or which mutants survived — the survivors were reported while the run was in flight and then absent from the summary that closes it.

  The verdict now states the thresholds, the report path, and every surviving mutant with its file, position, mutator and replacement.

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@5.0.0
