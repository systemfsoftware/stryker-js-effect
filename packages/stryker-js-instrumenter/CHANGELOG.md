# @systemfsoftware/stryker-js-instrumenter

## 12.1.1

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@14.0.0

## 12.1.0

### Minor Changes

- `Span`, `ScriptOrigin`, `Offset` and `LineStarts` are now exported from the package root, beside their existing `Source` namespace grouping, so a consumer can import them by name.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-cli-contract@0.3.0
  - @systemfsoftware/stryker-js-plugin-interface@13.0.0

## 12.0.0

### Major Changes

- Effect moves to the stable `4.0.0` release, together with the `@effect/*` packages these libraries use. The `4.0.0` release candidates are no longer supported: install `effect` `^4.0.0` next to these packages before upgrading.

  The TypeScript checker and test-runner plugins bundle their own Effect runtime, so they need no change in your project.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-cli-contract@0.2.0
  - @systemfsoftware/stryker-js-plugin-interface@12.0.0

## 11.0.0

### Major Changes

- Mutant identity, status, location, coverage and run options are re-exported from `@systemfsoftware/stryker-js-plugin-interface` as `Mutant`; `Mutator` now holds the registry, catalog and selection, and `Source` holds `LineStarts`, `Offset`, `ScriptOrigin` and `Span`. A mutant switch on a conditional's test is printed in parentheses now, so a ternary-test mutant no longer replaces the whole conditional. Mutants ignored by a `// Stryker disable` directive no longer shift the placed replacements beside them, so every activated arm runs its own replacement.

  Import the moved identity types from the plugin interface.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@11.0.0

## 10.0.1

### Patch Changes

- The packages now depend on `@systemfsoftware/effect-cell-types` 11.

  - Every tagged error now has a one-line message built from its fields, so a failure names the file, mutant, plugin, worker or exit code involved instead of an empty message. The errors' tags, fields and encoded forms are unchanged.

## 10.0.0

### Major Changes

- Rendering a caught cause is a function now, not a method on a schema class. `ErrorText.errorTextOf(cause)` and `ErrorText.causeTextOf(cause)` replace `ErrorText.ErrorText.fromCause(cause)` and `ErrorText.CauseText.fromCause(cause)`.

  Replace the two calls: `ErrorText.ErrorText.fromCause(cause)` becomes `ErrorText.errorTextOf(cause)`, and `ErrorText.CauseText.fromCause(cause)` becomes `ErrorText.causeTextOf(cause)`. Both return the same `Option.Option<ErrorText>` and `Option.Option<CauseText>` as before. The `ErrorText` and `CauseText` classes, their value types, and `ErrnoException` are unchanged.

- File names handed to `instrument` are canonicalized: a backslash in an input path is folded to `/`, in the returned file names and in each mutant's file name alike. A result now reports one spelling of a path, matching the spelling `Mutant.fileName` already used, instead of echoing whatever separator the caller passed.

  No call-site change is needed — keep passing plain strings to `instrument`.

- Mutant ids are decimal index strings. Every schema that carried a mutant id as a plain string now decodes `Mutant.MutantId` and refuses anything else: the mutation report and its mutant results, reporter events (`mutationTestingPlanReady` plans, `mutantTested`), the machine run stream (`mutant` and `verdict`), the survivors prior report, and the mutant coverage keys produced by test runners.

  Mutant ids are minted only as the mutant's canonical non-negative decimal index (`Mutant.MutantId`), including in the instrumenter's planned mutants, placement sites, and checker answers. Consume the new `Mutant.MutantId` schema instead of assuming an arbitrary non-empty string; ids such as `constructor` or `__proto__` no longer decode.

- A mutant's status is declared once, as the eight-value `Mutant.MutantStatus`, plus the named subsets a run partitions on: `Mutant.SurvivorStatus`, `Mutant.RememberedStatus`, `Mutant.EphemeralStatus`, and `Mutant.ActionableStatus`. Import the subset your decision matches instead of re-listing the statuses you accept.

  Mutants are tagged structs now. A status reason decodes only together with a status, and the remembered-mutant and ignored-mutant rows carry the same narrowed status as the subset they were selected by.

- Source locations are 1-based and validated end to end. `Mutant.Location`, `Mutant.Position`, `Mutant.Span`, `Mutant.OpenEndLocation`, `Mutant.ScriptOrigin`, and `Mutant.LineStarts` replace the former `LocationSchema`, `PositionSchema`, and `OpenEndLocationSchema`; a location whose end precedes its start, or a line or column below 1, no longer decodes.

  - A mutant location always speaks the report contract, so a producer that minted 0-based coordinates or a bare number must switch to the new schemas.
  - An embedded script's origin is a `ScriptOrigin` (1-based line plus a column shift), not a position.
  - Incremental state from releases that stored the earlier column base is no longer matched: those mutants are re-tested, not reused, while the run rewrites the state.

### Patch Changes

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.

## 9.0.1

### Patch Changes

- The packages now build on the latest `@systemfsoftware/effect-cell-types` 10.2 cell kinds, with no change to their published behavior.

  - `@systemfsoftware/stryker-test-contribution` exports its evaluator as `Judge`, `TestContribution`, and `TestContributionEvaluator`, and now depends on `effect` directly.

## 9.0.0

### Major Changes

- Mutant ids, mutator names and file names are now branded schemas, and the string helpers are replaced by codecs.

  - Build ids and names with `MutantId`, `MutatorName` and `CanonicalFileName`. Empty values are refused.
  - Replace `errorToString` with `ErrorText.fromCause` and `causeText` with `CauseText.fromCause`. Both return an `Option`.
  - Replace `normalizeFileName` with a `CanonicalFileName` decode, and `isMutant` with `Schema.is(Mutant)`.
  - Read the values formerly in `INSTRUMENTER_CONSTANTS` from the `InstrumenterContext` statics.

- Each package's main entry point now groups its exports into namespaces named after a capability, such as `Plugin`, `TestRunner` and `Report`.

  - Import the namespace and qualify each name, for example `Plugin.TestRunnerRpcs` after importing `Plugin` from the plugin interface.
  - Import instrumenter schemas such as `Location` and `MutantStatus` from the instrumenter's `Mutant` namespace, and plugin-interface names from the plugin interface, instead of through another package's entry point.
  - The engine's `/config`, `/events` and `/promises` entry points are unchanged.

- HTML templates and Svelte components are no longer instrumented by this package
  on their own: each format now comes from its framework plugin, the Angular
  plugin for `.html`, `.htm`, and `.vue` and the Svelte plugin for `.svelte`, both
  published alongside this release. Install the plugin whose format your project
  uses and add it to `plugins`. A file whose extension no loaded format claims is
  reported in the run's skipped files instead of being instrumented, and `svelte`
  is no longer an optional peer dependency of this package; the
  `angular-html-parser` dependency moves to the Angular plugin.

  The Angular signal ignore rule is unaffected and continues to ship in
  `@systemfsoftware/stryker-ignorer-angular`.

- The format registry can now be extended with a framework plugin's contribution:
  `frameworkEntryOf` adapts a `Framework` into a registry entry whose parse,
  transform, print, and disable-type-checks hooks delegate to the plugin over its
  embedded document, and the AST union gains the embedded-document variant those
  entries parse to.

  A registry entry you build yourself must now declare the `owner` module of its
  format, the `ownerVersion` incremental state keys on, and a `transform` hook; an
  entry without them no longer type-checks.

### Patch Changes

- Every mutant now reports its position as 1-based coordinates — the base the
  mutation-testing report schema uses, where the first line of a file and the
  first character of a line both sit at the first position.

  A mutant in a plain TypeScript or JavaScript file previously reported a line one
  below its real position, so pointing a reader at the reported coordinates
  highlighted the wrong line.

## 8.1.0

### Minor Changes

- Three opt-in mutators plant Effect concurrency faults on top of the default set, so a mutation run can check that your concurrency tests catch races. `AtomicUpdateSplit` splits read-modify-write calls on `Ref` and `SynchronizedRef` into a separate read, a yield, and a separate write. `SynchronizationRemoval` removes semaphore permits, `Effect.uninterruptible`, and `Effect.uninterruptibleMask`. `FinalizerEscape` stops `ensuring`, `onExit`, `onError`, `onInterrupt`, `acquireRelease`, and `acquireUseRelease` cleanup from running on interruption. All three are off by default. Enable any subset by listing them under `mutator: { optInMutations: [...] }` in your configuration. A name that is not an opt-in mutator fails the run, and the error lists the known names. The replacements use Effect 4 APIs, so a repository on Effect 3.x must not opt in.

### Patch Changes

- Disable comments with the `next-line` scope now ignore the mutants on the line directly below the comment and record the given reason. Before this fix they ignored nothing.

## 8.0.2

### Patch Changes

- Exported declarations that previously took `unknown` now take a defaulted type parameter: calls that omit the type argument are unchanged, and calls that were previously rejected for passing an unconstrained value are accepted. No runtime behaviour changes.

## 8.0.1

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

- Mutating a negated property check such as `if (!obj.prop)` no longer aborts the run with a placement error. Mutations inside `as const` expressions are generated again; previously every literal inside an `as const` object or array was silently skipped, which inflated the reported mutation score.

## 8.0.0

### Major Changes

- The built-in reporters, plugin loading and their types are no longer published
  from separate entry points on `@systemfsoftware/stryker-js`; import them from
  `@systemfsoftware/stryker-js`. The mutant vocabulary — `Mutant`, `Location`,
  `Position` and their schemas — is importable only from
  `@systemfsoftware/stryker-js-instrumenter`.

## 7.1.0

### Minor Changes

- Types that appear on the published CLI and instrumenter APIs are now exported.

## 7.0.0

### Major Changes

- `disableTypeChecks` and `instrument` now return lazy `Effect` values instead of a `Promise` and a plain result, so a caller decides when the transformation runs: `disableTypeChecks(file)` is `Effect<File, InstrumentError>` and `instrument(files, options)` is `Effect<InstrumentResult, InstrumentError>`. Interpret them with your own runtime — `Effect.runPromise(disableTypeChecks(file))` reproduces the old await.

  The Angular signal ignorer moved out of this package to `@systemfsoftware/stryker-ignorer-angular`, and the `strykerPlugins` and `frameworkPluginsFileUrl` exports are gone. A plugin package discovers its ignorers through the ignorer contract instead.

### Minor Changes

- `instrument` accepts an optional `basePath` used to relativize placement-error paths instead of the process working directory. Pass the run's base path; omitting it keeps absolute file names in error messages.

- `angularIgnorer`'s decision now receives `(node, ancestors)` — the node and its
  ancestors as typed positions from the ignorer contract — instead of a path
  object. The node vocabulary in this package's declarations is the one published
  by `@systemfsoftware/stryker-ignorer-interface`, which is now a dependency.

### Patch Changes

- Maintenance release. Every published entry point, export, option, and behaviour is exactly as it was.

- effect dependency range widens from the exact 4.0.0-rc.112 pin to ^4.0.0-rc.112; repository metadata now points at stryker-js-effect

## 6.0.1

### Patch Changes

- Imports rewired to the collapsed `@systemfsoftware/stryker-js` root entry; each package now co-releases against the root-entry major.

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@8.0.0
  - @systemfsoftware/stryker-js@4.0.0

## 6.0.0

### Major Changes

- Nothing a consumer can observe moved in the four packages above, so no release is warranted.

  `@systemfsoftware/stryker-js-instrumenter` now answers with promises: `transform` and `placeHeader` return `Promise`, and `AstTransformer` is a promise-returning function type. Await them where you call them. The parser is read on first use rather than at import, so importing this package no longer constructs Node's WebAssembly runtime, and `ExperimentalWarning: WASI` no longer appears until something is actually parsed.

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

### Patch Changes

- Peer Effect requirement advances to 4.0.0-rc.112. No API changes.

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

- instrument() keeps its public signature; the decision moved to a plain kernel, and the instrument workflow now distinguishes in-place from ephemeral output

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@6.0.0
  - @systemfsoftware/stryker-js@1.0.0

## 3.0.1

### Patch Changes

- Refreshed builds on the platform-services dependency graph; the packages no longer reach for host builtins directly. No CLI flags or option names change.

- Updated dependencies:
  - @systemfsoftware/stryker-js@0.2.0

## 3.0.0

### Major Changes

- The instrumenter parses and prints with oxc and a bundled ESTree printer; all Babel packages are gone. The instrumenter options no longer accept a `plugins` list (oxc parses modern JS/TS, JSX, and decorators natively), the instrumentation header export is named `instrumentationHeader`, and the script transformer is named `transformScript`.

## 2.0.1

### Patch Changes

- Peer Effect requirement advances to 4.0.0-rc.112. No API changes.

## 2.0.0

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

- Selecting `workflow-make-boundary` keeps mutants inside `Workflow.make` decision bodies.

  Ignore plugins are asked about each mutant, not about the file root with a subtree latch. An inverted selector that answers "ignore" for everything outside a make body therefore no longer ignores the make body itself. Inner mutants of declaration-style ignore plugins (`effect-schema-declarations`, Angular signal option objects) are still ignored.

- Instrumenting a file that calls a method named after an `Object.prototype`
  member - `toString`, `valueOf`, `constructor` and the rest - no longer fails
  with `Property name expected type of string but got function`. The method
  mutator's replacement table answered such a lookup with the inherited function
  rather than reporting no replacement, and a single `.toString()` call was enough
  to stop the run. Those methods are now left alone, as they always should have
  been.

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@5.0.0

## 1.0.0

### Major Changes

- Parse, transform and mutant-placement failures now carry a message naming the
  file and what went wrong, and their `cause` survives being written to JSON — so
  a failure that crossed a process boundary no longer arrives blank.

  Every error tag is now qualified, which is what makes two identically named
  errors from different packages distinguishable.

  `MutantPlacementFailed` is removed; it was a second name for `PlacementFailed`
  and had no constructor anywhere. Match `PlacementFailed`.

- svelte is now an optional peer dependency. Install it to mutate .svelte components; without it, every other file type is unaffected. A copy of the Svelte compiler used to be bundled in, which pinned whichever version was present when the package was built and made the compiler version check read the wrong answer.

### Patch Changes

- The instrumenter no longer depends on `weapon-regex`, a Scala library compiled to JavaScript that is no longer maintained. It is replaced by `@eslint-community/regexpp`, which has no dependencies of its own. Regular expression mutants are unchanged, so no action is required.

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

- When a mutant cannot be placed, the reported error now links to this project's issue tracker rather than the upstream StrykerJS one.

- Published packages no longer carry build artifacts left over from earlier builds. One package was shipping about a megabyte of bundled test-runner internals this way.

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-api@3.0.0

## 0.2.0

### Minor Changes

- Two new packages complete this scope's mutation toolchain: the instrumenter,
  which places mutants and coverage hooks in source files, and the shared helpers
  the toolchain uses at runtime. Both are installed for you as dependencies of the
  engine — install them directly only if you assemble the pipeline yourself.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-util@0.2.0
