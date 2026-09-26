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
