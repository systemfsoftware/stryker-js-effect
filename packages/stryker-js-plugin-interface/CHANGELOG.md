# @systemfsoftware/stryker-js-plugin-interface

## 14.0.0

### Major Changes

- A mutant's timeout now starts when its first test begins, not when the test runner is asked to run it. With a short `timeoutMS`, a mutant its tests would kill is reported `Killed` instead of `Timeout`, so a slow or busy machine no longer changes the verdict. A mutant whose tests never begin still ends, on the same window that bounds a plugin worker which never accepts its connection.

  If you author a test-runner plugin, `mutantRun` now streams its run: emit `MutantRunStarted` before the runner's first test begins, then `MutantRunSettled` carrying the result.

## 13.0.0

### Major Changes

- The TypeScript checker now applies Trivial Compiler Equivalence (Papadakis et al., ICSE 2015). Each mutant of a file is emitted to JavaScript from the project's own TypeScript configuration in transpile-only mode, normalized, and compared with the original file's emit and with the mutants already emitted at the same site. A mutant whose emit equals the original's is dropped as `Ignored` with reason `equivalent-to-original: tce`; one that equals an earlier same-site mutant's is dropped with `duplicate-at-site: tce`; every mutant whose emit differs is kept, so the check never removes a mutant that changes the program. Checkers gain an `ignored` result variant carrying the suppression reason, and a run publishes the new `tce` machine-stream event with the `equivalentToOriginal` and `duplicateAtSite` counts. Verdict semantics move to version 3.

### Minor Changes

- Mutation testing is now incremental by default: `incremental` defaults to `true`, so an unchanged mutant whose covering tests are unchanged is re-used instead of re-run. `--full` (aliasing the old `--force`) re-verifies every mutant, ignoring the cache and the persisted dry run. The `verdict` stream event records `incrementalMode` (`incremental` or `full`). A run with no reusable cache falls back to a full run as before.

## 12.0.0

### Major Changes

- Effect moves to the stable `4.0.0` release, together with the `@effect/*` packages these libraries use. The `4.0.0` release candidates are no longer supported: install `effect` `^4.0.0` next to these packages before upgrading.

  The TypeScript checker and test-runner plugins bundle their own Effect runtime, so they need no change in your project.

## 11.1.0

### Minor Changes

- The new `surfacing` option (default `{ perLine: 1, perFile: 7 }`) caps how many survivors are listed per line and per file, while every survivor still counts toward the score.

### Patch Changes

- Fixed mutant coverage whose hit counts were keyed by anything other than a mutant id being silently emptied on decode — such a payload now fails validation, so a mismatched runner/plugin pair reports the key mismatch instead of planning every mutant as uncovered.

## 11.0.0

### Major Changes

- The plugin contract now owns mutant identity, the mutator catalog and the report. `Mutant` holds the status enum and its subsets, `MutantId`, `MutatorName`, `CanonicalFileName`, `Location`, `Position` and `OpenEndLocation`. `MutatorCatalog` declares a catalog entry and refuses one with no examples, an empty `before` snippet, a duplicated id or name, or a name its provider does not own; `MutatorProvider` declares the `strykerMutators` contribution a mutator plugin exports; and `Report` carries the report contract generated from the pinned upstream `mutation-testing-report-schema` plus this product's fields.

  Report mutant ids follow the upstream schema and decode as strings, so a report another tool wrote decodes too; report numbers are finite, so `NaN` and `Infinity` are refused.

  `Location` and `OpenEndLocation` decode from a plain `{ start, end }` struct, so a JSON Schema document derived from them states the position fields instead of an empty schema.

  Import mutant identity, status, location, catalog and report types from here; the instrumenter and the engine no longer re-export them.

## 10.0.1

### Patch Changes

- The packages now depend on `@systemfsoftware/effect-cell-types` 11.

  - Every tagged error now has a one-line message built from its fields, so a failure names the file, mutant, plugin, worker or exit code involved instead of an empty message. The errors' tags, fields and encoded forms are unchanged.

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

## 9.0.0

### Major Changes

- `Report.Metrics#mutationScore` and `Report.Metrics#mutationScoreBasedOnCoveredCode` now return a `Report.MutationScore` instead of a number: `Scored` with a `percentage` between 0 and 100, or `Unscored` when no tested mutant counts toward the score. Previously an empty run produced `NaN`, which compared false against every threshold.

  Code that read the score as a number must match on it:

  ```ts
  // before
  const failing = metrics.mutationScore < 80

  // after
  const failing = Report.MutationScore.match(metrics.mutationScore, {
    Scored: ({ percentage }) => percentage < 80,
    Unscored: () => false,
  })
  ```

## 8.0.0

### Major Changes

- The in-process `vm` runner is now the default `testRunner`. With no `testRunner` and no `testFiles` configured, the vm runner asks Vitest which files are tests. It runs exactly the files `vitest run` would, including your config's `include`, `exclude`, and `includeSource`, or Vitest's defaults when there is no config file. A run that loads no test files, or whose initial run registers zero tests, now fails the dry run with an error naming the `vm` runner and pointing at `testFiles`, instead of reporting a successful run where every mutant survives. Projects that relied on the previous default shelling out to a test command must set `testRunner: 'command'` (or `'vitest'`) to keep that behaviour.

## 7.3.0

### Minor Changes

- Three opt-in mutators plant Effect concurrency faults on top of the default set, so a mutation run can check that your concurrency tests catch races. `AtomicUpdateSplit` splits read-modify-write calls on `Ref` and `SynchronizedRef` into a separate read, a yield, and a separate write. `SynchronizationRemoval` removes semaphore permits, `Effect.uninterruptible`, and `Effect.uninterruptibleMask`. `FinalizerEscape` stops `ensuring`, `onExit`, `onError`, `onInterrupt`, `acquireRelease`, and `acquireUseRelease` cleanup from running on interruption. All three are off by default. Enable any subset by listing them under `mutator: { optInMutations: [...] }` in your configuration. A name that is not an opt-in mutator fails the run, and the error lists the known names. The replacements use Effect 4 APIs, so a repository on Effect 3.x must not opt in.

## 7.2.1

### Patch Changes

- Exported declarations that previously took `unknown` now take a defaulted type parameter: calls that omit the type argument are unchanged, and calls that were previously rejected for passing an unconstrained value are accepted. No runtime behaviour changes.

## 7.2.0

### Minor Changes

- A finite mutant is killed or survived from its tests. Timeout is reserved for one named nonterminating trap, detected by a hit bound rather than a wall-clock budget. A wall-clock timeout fails the run instead of being stored as a detected mutant.

## 7.1.1

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

## 7.1.0

### Minor Changes

- A checker that fails now fails mutation testing with that checker's cause, instead of crashing with an empty error. The TypeScript checker type-checks each mutant, so compile errors appear in the report. Verdict counts are non-negative integers; `Metrics` is a class you can build from mutant statuses; a threshold `low` may not exceed `high`.

## 7.0.0

### Major Changes

- The checker request carries a plain data record, not the instrumenter's `Mutant` class. `CheckerRequest.mutants` and `CheckerService.check`/`group` now speak `CheckerMutantWire` - `id`, `fileName`, `mutatorName`, `replacement`, and `location`. A mutant that cannot be described to a checker is skipped instead of reaching it.

  With `OTEL_ENABLED=true` the CLI now exports its OpenTelemetry metrics to `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_METRIC_EXPORT_INTERVAL` sets the export interval in milliseconds. Checker timings, mutant counts, and worker crashes now reach a metrics backend.

  `ConfigEnv` and `resolveExtends` are no longer exported. Import `ConfigEnv` from the config entry point of the package, and read merged options with `loadConfigCell` or `readConfig` from the package root - either performs the `extends` walk, validation and merge in order.

## 6.0.1

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@8.0.0

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

## 5.0.0

### Major Changes

- The plugin system now runs each configured TestRunner/Checker/Reporter plugin in its own spawned process over an @effect/rpc wire: plugins load from the project's config-declared specifiers (no glob discovery), boundary failures are typed errors, and plugin spans link into the host trace. Breaking: the in-process plugin Layer contract is removed.

- `@systemfsoftware/stryker-js` is renamed to `@systemfsoftware/stryker-js-language`, and the plugin boundary now ships as the two packages `@systemfsoftware/stryker-js-plugin-interface` and `@systemfsoftware/stryker-js-plugin-runtime`.

  `@systemfsoftware/stryker-js-plugin-interface` owns the contract both sides of the process split agree on: the per-kind `@effect/rpc` groups (`TestRunnerRpcs`, `CheckerRpcs`, `ReporterRpcs`), the boundary payload schemas, the typed boundary errors (`BoundaryPayloadRejected`, `BoundaryUnrecognizedSignal`), the spawn contract (`WorkerPluginKind`, `WorkerPluginSpawnSchema`, `WorkerEntryUrl`), and the trace-context contract (`TraceContextMiddleware`, `PropagatedTrace`, `TracedRpc`, `formatTraceparent`, `parseTraceparent`, `TraceContextReference`, `TRACEPARENT_HEADER`, `TRACESTATE_HEADER`).

  `@systemfsoftware/stryker-js-plugin-runtime` owns what a plugin process actually runs: the worker server layer a plugin's `main.ts` launches (`workerServerLayer`, `nodeModuleLayer`), the worker and host OTel bootstraps (`startWorkerTelemetry`, `startHostTelemetry`), the worker-options wire codec (`encodeWorkerOptions`, `decodeWorkerOptions`, `readWorkerOptionsFromEnv`), and the trace-context middleware implementations (`layerTraceContextClient`, `layerTraceContextServer`, `withLinkedSpan`, `tracePartsOf`).

  To migrate, update the package name on every import that is not a plugin symbol to `@systemfsoftware/stryker-js-language`; install `@systemfsoftware/stryker-js-plugin-interface` and import the contract symbols listed above from it, and install `@systemfsoftware/stryker-js-plugin-runtime` for the worker-side symbols. The former in-process surface (`declarePlugin`, `composePlugins`, `PluginContribution`, `PluginLayerContribution`, `PluginKind`, `PluginEnvironment`, `RunConfiguration`, `SandboxDirectory`) no longer exists: a plugin now declares `strykerPlugins: readonly { kind, name }[]` and a worker entry exported under `./worker` (or a `bin`) that serves the per-kind `RpcServer`.

### Patch Changes

- Maintenance release. Every published entry point, export, option, and behaviour is exactly as it was.
