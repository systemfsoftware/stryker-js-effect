# @systemfsoftware/stryker-js-typescript-checker

## 8.3.0

A checker plugin must now report the program it loaded. `CheckerService` gains a
`digest` holding the digest of that program, the checker RPC exposes it as
`digest`, and a TypeScript checker answers with the digest of the TypeScript
program it built: the hashed content of every source file the program loaded
(project files, declaration files and the ones TypeScript ships), the tsconfig
files it was built from, the TypeScript version, the checker's own version, and
its configured options. The digest is stable for an unchanged program and moves
when any of those change.

Breaking for checker plugin authors: a checker worker that does not answer the
`digest` RPC no longer works with the engine. Add a `digest` handler that
returns the digest of everything your check reads. Effect moves to `4.0.0-rc.117`, together with the `@effect/*` packages these libraries use. Projects that install `effect` next to them need the same release.

- The TypeScript checker and test-runner workers now bundle their own runtime, so the only modules they load from your project are the TypeScript compiler and your test framework.
- The test-runner plugin supports the framework's fifth major release.
- The ignorer interface re-exports the `oxc-parser` 0.150 AST, in which `FormalParameterRest.decorators` is `Array<Decorator>`. Enable the `@effect/language-service` tsgo plugin in every source package's `tsconfig.app.json` and `tsconfig.test.json`, and bump `@effect/tsgo` to `^0.50.0`. This turns on Effect-aware diagnostics during `effect-tsgo` type checking; it changes no runtime behaviour or public API.

## 8.2.1

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@14.0.0

## 8.2.0

### Minor Changes

- The TypeScript checker now applies Trivial Compiler Equivalence (Papadakis et al., ICSE 2015). Each mutant of a file is emitted to JavaScript from the project's own TypeScript configuration in transpile-only mode, normalized, and compared with the original file's emit and with the mutants already emitted at the same site. A mutant whose emit equals the original's is dropped as `Ignored` with reason `equivalent-to-original: tce`; one that equals an earlier same-site mutant's is dropped with `duplicate-at-site: tce`; every mutant whose emit differs is kept, so the check never removes a mutant that changes the program. Checkers gain an `ignored` result variant carrying the suppression reason, and a run publishes the new `tce` machine-stream event with the `equivalentToOriginal` and `duplicateAtSite` counts. Verdict semantics move to version 3.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-cli-contract@0.3.0
  - @systemfsoftware/stryker-js-plugin-interface@13.0.0

## 8.1.1

### Patch Changes

- Effect moves to the stable `4.0.0` release, together with the `@effect/*` packages these libraries use. The `4.0.0` release candidates are no longer supported: install `effect` `^4.0.0` next to these packages before upgrading.

  The TypeScript checker and test-runner plugins bundle their own Effect runtime, so they need no change in your project.

- Updated dependencies:
  - @systemfsoftware/stryker-js-cli-contract@0.2.0
  - @systemfsoftware/stryker-js-instrumenter@12.0.0
  - @systemfsoftware/stryker-js-plugin-interface@12.0.0
  - @systemfsoftware/stryker-js-plugin-runtime@7.0.0

## 8.1.0

### Major Changes

- The TypeScript checker now type-checks each mutant on its own, so a mutant is `CompileError` only when that mutant fails to compile, and checking finishes much sooner on large projects. Files that import a mutated file are checked only when the mutant changes what that file exports.

  The `prioritizePerformanceOverAccuracy` option is removed. Delete it from your `checkers` options.

### Patch Changes

- Fixed a rare hang where a run stopped making progress while a test runner or checker worker waited for a message that had already arrived. The message now always wakes the worker waiting for it.

## 8.0.1

### Patch Changes

- The packages now depend on `@systemfsoftware/effect-cell-types` 11.

  - Every tagged error now has a one-line message built from its fields, so a failure names the file, mutant, plugin, worker or exit code involved instead of an empty message. The errors' tags, fields and encoded forms are unchanged.

## 8.0.0

### Major Changes

- Source locations are 1-based and validated end to end. `Mutant.Location`, `Mutant.Position`, `Mutant.Span`, `Mutant.OpenEndLocation`, `Mutant.ScriptOrigin`, and `Mutant.LineStarts` replace the former `LocationSchema`, `PositionSchema`, and `OpenEndLocationSchema`; a location whose end precedes its start, or a line or column below 1, no longer decodes.

  - A mutant location always speaks the report contract, so a producer that minted 0-based coordinates or a bare number must switch to the new schemas.
  - An embedded script's origin is a `ScriptOrigin` (1-based line plus a column shift), not a position.
  - Incremental state from releases that stored the earlier column base is no longer matched: those mutants are re-tested, not reused, while the run rewrites the state.

### Patch Changes

- The TypeScript checker describes a tsconfig document through the schema that declares the keys it interprets, so an override round-trips the document it was given, and the mutant it cannot describe to a checker carries the canonical file-name brand. The plugin contract, configurations, reports, and exit codes are unchanged.

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@10.0.0
  - @systemfsoftware/stryker-js-plugin-interface@10.0.0

## 7.1.2

### Patch Changes

- Mutants are now type-checked incrementally. Checking a mutant costs its own file and the files that import it — through a relative path, a path alias, or a re-export — instead of a full type check of every project the checker opens, so a run whose mutants all live in one file finishes instead of staying at zero completed mutants until the run is killed.

  A mutation that breaks a file which imports the mutated file is still a `CompileError` rather than being handed to the test runner.

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@9.0.0

## 7.1.1

### Patch Changes

- The packages now build on the latest `@systemfsoftware/effect-cell-types` 10.2 cell kinds, with no change to their published behavior.

  - `@systemfsoftware/stryker-test-contribution` exports its evaluator as `Judge`, `TestContribution`, and `TestContributionEvaluator`, and now depends on `effect` directly.

## 7.1.0

### Patch Changes

- The checker no longer looks dead while it type-checks. A check that runs longer than the host's connection patience window used to leave the checker unable to answer the host, dropping its connection mid-run; long checks are now answered and the connection survives them.

- The typescript checker no longer discards `include`, `exclude`, `files`, `extends`, and any other unrecognized top-level key from the tsconfig it rewrites. Projects that list files outside the default include patterns, import their own package manifest, or extend a shared preset now type-check during mutation runs the same way they do under `tsc`; only the compiler options the checker intentionally overrides still differ, and single-project mode alone drops `references`. Referenced projects are covered too: every tsconfig a build-mode project references is rewritten with those same overrides, so a library that opts into `noUnusedLocals` (or any option the checker overrides) is checked under the checker's settings instead of its own.

## 7.0.5

### Patch Changes

- Exported declarations that previously took `unknown` now take a defaulted type parameter: calls that omit the type argument are unchanged, and calls that were previously rejected for passing an unconstrained value are accepted. No runtime behaviour changes.

## 7.0.4

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

## 7.0.3

### Patch Changes

- A checker that fails now fails mutation testing with that checker's cause, instead of crashing with an empty error. The TypeScript checker type-checks each mutant, so compile errors appear in the report. Verdict counts are non-negative integers; `Metrics` is a class you can build from mutant statuses; a threshold `low` may not exceed `high`.

## 7.0.2

### Patch Changes

- The checker request carries a plain data record, not the instrumenter's `Mutant` class. `CheckerRequest.mutants` and `CheckerService.check`/`group` now speak `CheckerMutantWire` - `id`, `fileName`, `mutatorName`, `replacement`, and `location`. A mutant that cannot be described to a checker is skipped instead of reaching it.

  With `OTEL_ENABLED=true` the CLI now exports its OpenTelemetry metrics to `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_METRIC_EXPORT_INTERVAL` sets the export interval in milliseconds. Checker timings, mutant counts, and worker crashes now reach a metrics backend.

  `ConfigEnv` and `resolveExtends` are no longer exported. Import `ConfigEnv` from the config entry point of the package, and read merged options with `loadConfigCell` or `readConfig` from the package root - either performs the `extends` walk, validation and merge in order.

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@7.0.0

## 7.0.1

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@8.0.0

## 7.0.0

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

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@6.0.0

## 6.0.0

### Major Changes

- The plugin system now runs each configured TestRunner/Checker/Reporter plugin in its own spawned process over an @effect/rpc wire: plugins load from the project's config-declared specifiers (no glob discovery), boundary failures are typed errors, and plugin spans link into the host trace. Breaking: the in-process plugin Layer contract is removed.

### Patch Changes

- Maintenance release. Every published entry point, export, option, and behaviour is exactly as it was.

- effect and typescript dependency ranges widen from exact catalog pins to repo catalog ranges; repository metadata now points at stryker-js-effect

## 5.0.4

### Patch Changes

- Imports rewired to the collapsed `@systemfsoftware/stryker-js` root entry; each package now co-releases against the root-entry major.

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@8.0.0
  - @systemfsoftware/stryker-js@4.0.0

## 5.0.3

### Patch Changes

- Releases the workspace so its published versions track the shared dependency graph this change moves.

- The `@systemfsoftware/source` export condition is gone. It resolved to a package's TypeScript sources for editors and in-repo typechecks; each package now exports only its built entry. If your tsconfig sets `customConditions: ["@systemfsoftware/source"]`, or a bundler config names that condition, remove it — resolution falls back to the built entry, which is what every consumer already got.

## 5.0.2

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@7.0.0

## 5.0.1

### Patch Changes

- Re-released against @systemfsoftware/stryker-js without the removed --llms manifest. The Run stream no longer carries a manifest terminal event, and the RunEvent / RunTerminalEvent unions no longer include the manifest arm, so any exhaustive consumer of those types must drop that case.

- Rebuilds against updated workspace dependencies, including the new
  `@systemfsoftware/stryker-js` reporter protocol major.

- Updated dependencies:
  - @systemfsoftware/stryker-js@3.0.0

## 5.0.0

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

### Minor Changes

- cut over to effect v4 (4.0.0-rc.108): public surface derives from effect types; peers flip effect ^3→^4

### Patch Changes

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

- These packages no longer install dependencies they never imported, so installing them pulls less into your tree.

  `tslib` is gone from all six. The mutation runner additionally stops installing `lodash.groupby`, `semver` and `source-map`, and the command line interface stops installing `@effect/platform-node-shared`. Nothing exported changes.

- Published packages no longer carry build artifacts left over from earlier builds. One package was shipping about a megabyte of bundled test-runner internals this way.

- Updated dependencies:
  - @systemfsoftware/stryker-js@2.0.0

## 4.0.0

### Major Changes

- CheckMutantsDecision is now a branded tagged union CheckFinished|RetestRequired instead of a plain record; consumer dispatch is exhaustive over the tags

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@6.0.0
  - @systemfsoftware/stryker-js@1.0.0

## 3.0.3

### Patch Changes

- Refreshed builds on the platform-services dependency graph; the packages no longer reach for host builtins directly. No CLI flags or option names change.

- Updated dependencies:
  - @systemfsoftware/stryker-js@0.2.0

## 3.0.2

### Patch Changes

- Re-published against the oxc-based instrumenter: workspace dependency ranges move to the new instrumenter major; no package's own behavior changes in this release.

## 3.0.1

### Patch Changes

- When two or more mutants in one TypeScript project file produce a compiler error that cannot be blamed on exactly one of them, `check` now rechecks each mutant alone. A mutant that typechecks by itself is reported `passed`. A mutant that fails typecheck by itself is reported `compileError`.

- Peer Effect requirement advances to 4.0.0-rc.112. No API changes.

## 3.0.0

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

### Patch Changes

- A type error inside an installed dependency's declaration files no longer fails the run.

  The checker exists to decide whether your source still compiles once a mutant is
  applied. It was also reporting errors from `.d.ts` files inside installed packages —
  most often a package whose optional peer dependency is not installed. No mutant
  causes those, every mutant reports the same ones, and the checker cannot act on
  them, so their only effect was to end the run before a single mutant was tested.

  Library declaration files are now skipped, alongside the code-quality options the
  checker already relaxes while mutating.

- An oversized message between the runner and a worker now fails the run with a
  reason instead of exhausting memory. Each side of the connection reads frames
  up to 16 MiB, which leaves headroom over the largest legitimate payload — a dry
  run carrying per-test coverage — and a frame past the limit fails the calls
  waiting on it rather than growing until the process dies.

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@5.0.0

## 2.0.0

### Major Changes

- The TypeScript compiler's methods return Effects instead of Promises, and the
  compiler is acquired for the length of the check. An interrupted check now
  releases the compiler instead of leaving it alive with the run's state still in
  it.

  Compiler failures are now a single tagged `CompilerFailed` error carrying a
  `reason` — the compiler used before initialization, no projects found for the
  tsconfig, an unknown file in the graph, or a project file missing from disk.
  They were untagged `Error`s before, so anything catching them saw one
  indistinguishable type.

  Diagnostics and `tsconfig` resolution are unchanged.

### Patch Changes

- The shared helpers package is gone. Nothing installs it any more, and the
  handful of helpers worth sharing now live in the plugin contract next to the
  types they serve:

  - `strykerReportBugUrl`, `normalizeFileName`, `propertyPath`, `errorToString`
    and `isErrnoException` from `@systemfsoftware/stryker-js-plugin-api/core`
  - `noopLogger` from `@systemfsoftware/stryker-js-plugin-api/logging`
  - `testFilesProvided` from `@systemfsoftware/stryker-js-plugin-api/test-runner`

  If you imported any of those, change the specifier. Everything else it exported
  had no consumer and is removed: use `Predicate.isNotNullish` from Effect in place
  of `notEmpty`, and `RegExp.escape` in place of `escapeRegExp`.

- These packages no longer install dependencies they never imported, so installing them pulls less into your tree.

  `tslib` is gone from all six. The mutation runner additionally stops installing `lodash.groupby`, `semver` and `source-map`, and the command line interface stops installing `@effect/platform-node-shared`. Nothing exported changes.

- Published packages no longer carry build artifacts left over from earlier builds. One package was shipping about a megabyte of bundled test-runner internals this way.

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-api@3.0.0

## 1.4.1

### Patch Changes

- Plugins are discovered under this scope by default. The `plugins` option now
  defaults to a glob over this scope instead of the original project's, so a
  configuration that relied on the previous default while installing plugins from
  the original project must now list those plugins explicitly. Discovery also no
  longer fails when no matching scope directory is installed: it loads nothing and
  warns.

  The report's dependency section names the packages of this scope, and the
  report's home link points at this project.

- Updated dependencies:
  - @systemfsoftware/stryker-js-util@0.2.0

## 1.4.0

### Minor Changes

- cut over to effect v4 (4.0.0-rc.108): public surface derives from effect types; peers flip effect ^3→^4

### Patch Changes

- Fail a compile on errors only, not on the tree's standing suggestions

  The dry run and the per-mutant check counted every diagnostic the program produced, so the Effect language service's suggestions — which the pristine tree carries by design and which surface in `lint:tsgo` and the editor — refused mutation runs outright with a dry-run compile error. Only error-category diagnostics fail a compile now; warnings and suggestions were never compile failures

- New version is published through npm trusted publishing, so it carries a provenance attestation you can verify.

- Each of these packages now has a README, so its registry page says what the package is, how
  to install it, and what to import or register — previously the page was blank. The lint
  plugins show the configuration line that enables what they recommend.

  `@systemfsoftware/stryker-js-mutation-report` also carries its licence text

- These packages no longer ship their development files. Sources, tests and build, lint and
  test configuration were all included, which broke consumers in one specific way: oxlint
  discovers configuration by walking directories, finds the published `oxlint.config.ts` under
  `node_modules`, and stops with "Stripping types is currently unsupported for files under
  node_modules" before linting anything.

  The installed package now contains the compiled output, the runtime schema files it reads,
  and the usual manifest, README and licence

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-api@2.0.0

## 1.3.0

### Minor Changes

- cut over to effect v4 (4.0.0-rc.108): public surface derives from effect types; peers flip effect ^3→^4

### Patch Changes

- Fail a compile on errors only, not on the tree's standing suggestions

  The dry run and the per-mutant check counted every diagnostic the program produced, so the Effect language service's suggestions — which the pristine tree carries by design and which surface in `lint:tsgo` and the editor — refused mutation runs outright with a dry-run compile error. Only error-category diagnostics fail a compile now; warnings and suggestions were never compile failures

- New version is published through npm trusted publishing, so it carries a provenance attestation you can verify.

- Each of these packages now has a README, so its registry page says what the package is, how
  to install it, and what to import or register — previously the page was blank. The lint
  plugins show the configuration line that enables what they recommend.

  `@systemfsoftware/stryker-js-mutation-report` also carries its licence text

- These packages no longer ship their development files. Sources, tests and build, lint and
  test configuration were all included, which broke consumers in one specific way: oxlint
  discovers configuration by walking directories, finds the published `oxlint.config.ts` under
  `node_modules`, and stops with "Stripping types is currently unsupported for files under
  node_modules" before linting anything.

  The installed package now contains the compiled output, the runtime schema files it reads,
  and the usual manifest, README and licence

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-api@1.0.0
