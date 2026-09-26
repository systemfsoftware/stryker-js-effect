## 10.0.0

### Major Changes

- Exit codes are one value: `Plugin.ExitCode`, an integer between 0 and 255. The machine stream's failure event, the command's run output, and the run conclusion all carry it, and a run conclusion's outcome is the closed set of run-outcome tags rather than free text.

  `Plugin.ExitCodeFromClass` stays the single exit-class to baseline-code mapping; read a code through it instead of writing the number where an exit class has to become an exit code.

- Building mutation metrics from mutants is a function now: `Report.Metrics.fromMutants(mutants)` becomes `Report.metricsFromMutants(mutants)`. Its `mutants` argument is typed as mutants carrying a `MutantStatus`, so a plain `{ status: string }` is refused.

  The `Metrics` class is unchanged: same counts, same `totalMutants`/`mutationScore`/`mutationScoreBasedOnCoveredCode` getters, same `MetricsResult` shape.

- Mutant ids are decimal index strings. Every schema that carried a mutant id as a plain string now decodes `Mutant.MutantId` and refuses anything else: the mutation report and its mutant results, reporter events (`mutationTestingPlanReady` plans, `mutantTested`), the machine run stream (`mutant` and `verdict`), the survivors prior report, and the mutant coverage keys produced by test runners.

  Mutant ids are minted only as the mutant's canonical non-negative decimal index (`Mutant.MutantId`), including in the instrumenter's planned mutants, placement sites, and checker answers. Consume the new `Mutant.MutantId` schema instead of assuming an arbitrary non-empty string; ids such as `constructor` or `__proto__` no longer decode.

- A mutant's status is declared once, as the eight-value `Mutant.MutantStatus`, plus the named subsets a run partitions on: `Mutant.SurvivorStatus`, `Mutant.RememberedStatus`, `Mutant.EphemeralStatus`, and `Mutant.ActionableStatus`. Import the subset your decision matches instead of re-listing the statuses you accept.

  Mutants are tagged structs now. A status reason decodes only together with a status, and the remembered-mutant and ignored-mutant rows carry the same narrowed status as the subset they were selected by.

- `Reporter.MutantTested` names the tested mutant's fields after the mutant itself: `file` is now `fileName` and `mutator` is now `mutatorName`. `id`, `status`, `location`, `replacement`, `completed` and `total` keep their roles, and the mutation stream's emitted lines are unchanged.

  Replace `mutant.file` with `mutant.fileName` and `mutant.mutator` with `mutant.mutatorName` where you build or read a `MutantTested`.

- Counts and durations that cannot be negative are refined where they are declared, through the shared non-negative integer and non-negative finite schemas. Test-runner counts and durations, the clear-text reporter's log limit, the dry-run timeout, a test run's hit counter and limit, and a run's help-error count now refuse a negative value instead of accepting it.

- Plugin boundaries carry their real values:

  - `Plugin.ReporterInitOptions.traceparent` and `tracestate` are typed by the W3C trace-context schemas (`Trace.Traceparent`, `Trace.Tracestate`) instead of plain strings, and an invalid traceparent is no longer forwarded to a reporter worker.
  - `Checker.CheckResultSchema` is the one source of a check result; `Checker.CheckStatus` is unchanged in value.
  - `Plugin.PluginKind` and `Plugin.EvaluatorPluginKind` are new and replace the repeated `'Evaluator'` literal.
  - The `maxConcurrentTestRunners`, `maxTestRunnerReuse`, `timeoutMS`, `timeoutFactor` and `concurrency` options refuse values outside their real range (negative durations, a zero or fractional worker count).

- Source locations are 1-based and validated end to end. `Mutant.Location`, `Mutant.Position`, `Mutant.Span`, `Mutant.OpenEndLocation`, `Mutant.ScriptOrigin`, and `Mutant.LineStarts` replace the former `LocationSchema`, `PositionSchema`, and `OpenEndLocationSchema`; a location whose end precedes its start, or a line or column below 1, no longer decodes.

  - A mutant location always speaks the report contract, so a producer that minted 0-based coordinates or a bare number must switch to the new schemas.
  - An embedded script's origin is a `ScriptOrigin` (1-based line plus a column shift), not a position.
  - Incremental state from releases that stored the earlier column base is no longer matched: those mutants are re-tested, not reused, while the run rewrites the state.

- Test identifiers are one value: `TestRunner.TestId`, a non-empty branded string carrying the runner's `file#test name` form. Test runner results, report test definitions, a mutant's killers and coverers, per-test hit records, and the test-contribution evaluation all speak that one type instead of bare strings.

  Mint one with `TestRunner.TestId.make(...)` where a runner derives a test id; the machine stream and mutation report schemas brand the ids they decode.

- Mutation score thresholds are declared once, as `Report.ThresholdsSchema`: `high`, `low`, and a `break` that is null when no breaking threshold is configured. The option file and the mutation report decode the same schema, and a pair whose `low` is above its `high` is refused with "a mutation score threshold pair has low at or below high".

  The mutation report's thresholds now include `break`, so a consumer reads the breaking threshold from the report instead of recovering it from the embedded reporter configuration.

### Patch Changes

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@10.0.0
