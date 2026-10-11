# @systemfsoftware/stryker-js-html-reporter

## 6.0.4

Updated dependency @systemfsoftware/stryker-js-cli-contract to 0.5.0

## 6.0.3

Effect moves to `4.0.0-rc.117`, together with the `@effect/*` packages these libraries use. Projects that install `effect` next to them need the same release.

- The TypeScript checker and test-runner workers now bundle their own runtime, so the only modules they load from your project are the TypeScript compiler and your test framework.
- The test-runner plugin supports the framework's fifth major release.
- The ignorer interface re-exports the `oxc-parser` 0.150 AST, in which `FormalParameterRest.decorators` is `Array<Decorator>`. Enable the `@effect/language-service` tsgo plugin in every source package's `tsconfig.app.json` and `tsconfig.test.json`, and bump `@effect/tsgo` to `^0.50.0`. This turns on Effect-aware diagnostics during `effect-tsgo` type checking; it changes no runtime behaviour or public API.

## 6.0.2

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@14.0.0

## 6.0.1

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-cli-contract@0.3.0
  - @systemfsoftware/stryker-js-plugin-interface@13.0.0

## 6.0.0

### Major Changes

- Effect moves to the stable `4.0.0` release, together with the `@effect/*` packages these libraries use. The `4.0.0` release candidates are no longer supported: install `effect` `^4.0.0` next to these packages before upgrading.

  The TypeScript checker and test-runner plugins bundle their own Effect runtime, so they need no change in your project.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-cli-contract@0.2.0
  - @systemfsoftware/stryker-js-instrumenter@12.0.0
  - @systemfsoftware/stryker-js-plugin-interface@12.0.0

## 5.0.5

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@11.0.0
  - @systemfsoftware/stryker-js-plugin-interface@11.0.0

## 5.0.4

### Patch Changes

- The packages now depend on `@systemfsoftware/effect-cell-types` 11.

  - Every tagged error now has a one-line message built from its fields, so a failure names the file, mutant, plugin, worker or exit code involved instead of an empty message. The errors' tags, fields and encoded forms are unchanged.

## 5.0.3

### Patch Changes

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@10.0.0
  - @systemfsoftware/stryker-js-plugin-interface@10.0.0

## 5.0.2

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@9.0.0

## 5.0.1

### Patch Changes

- The packages now build on the latest `@systemfsoftware/effect-cell-types` 10.2 cell kinds, with no change to their published behavior.

  - `@systemfsoftware/stryker-test-contribution` exports its evaluator as `Judge`, `TestContribution`, and `TestContributionEvaluator`, and now depends on `effect` directly.

## 5.0.0

### Major Changes

- Each package's main entry point now groups its exports into namespaces named after a capability, such as `Plugin`, `TestRunner` and `Report`.

  - Import the namespace and qualify each name, for example `Plugin.TestRunnerRpcs` after importing `Plugin` from the plugin interface.
  - Import instrumenter schemas such as `Location` and `MutantStatus` from the instrumenter's `Mutant` namespace, and plugin-interface names from the plugin interface, instead of through another package's entry point.
  - The engine's `/config`, `/events` and `/promises` entry points are unchanged.

### Minor Changes

- Each run stage, checker call, report write and test-runner mutant run now records an OpenTelemetry span named after its cell. The span has `.read` and `.write` child spans and an `app.<name>.decision` or `app.<name>.failure` attribute holding the outcome. It also feeds an `app.<name>.duration` histogram labelled `result_class`.

- `makeHtmlReporter` can now be called with the reporter options alone, `makeHtmlReporter(options)`, and handed the reporter init when the run starts. The existing two-argument call, `makeHtmlReporter(options, init)`, keeps working exactly as before and remains the form the engine calls.

### Patch Changes

- The HTML report opens in the browser again. A cut-off logo image left the page markup unfinished, so the report never loaded and the page stayed blank.

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@9.0.0
  - @systemfsoftware/stryker-js-plugin-interface@8.0.0

## 4.0.5

### Patch Changes

- Exported declarations that previously took `unknown` now take a defaulted type parameter: calls that omit the type argument are unchanged, and calls that were previously rejected for passing an unconstrained value are accepted. No runtime behaviour changes.

## 4.0.4

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

## 4.0.3

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@7.0.0

## 4.0.2

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@8.0.0

## 4.0.1

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@6.0.0

## 4.0.0

### Major Changes

- The plugin system now runs each configured TestRunner/Checker/Reporter plugin in its own spawned process over an @effect/rpc wire: plugins load from the project's config-declared specifiers (no glob discovery), boundary failures are typed errors, and plugin spans link into the host trace. Breaking: the in-process plugin Layer contract is removed.

### Patch Changes

- Maintenance release. Every published entry point, export, option, and behaviour is exactly as it was.

- effect peer range widens to ^4.0.0-rc.112 and the platform-node-shared dependency range widens to the repo catalog; repository metadata now points at stryker-js-effect

## 3.0.3

### Patch Changes

- Imports rewired to the collapsed `@systemfsoftware/stryker-js` root entry; each package now co-releases against the root-entry major.

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@8.0.0
  - @systemfsoftware/stryker-js@4.0.0

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

### Patch Changes

- Re-released against @systemfsoftware/stryker-js without the removed --llms manifest. The Run stream no longer carries a manifest terminal event, and the RunEvent / RunTerminalEvent unions no longer include the manifest arm, so any exhaustive consumer of those types must drop that case.

- Updated dependencies:
  - @systemfsoftware/stryker-js@3.0.0

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

- effect is now a required peer dependency. Install it alongside these packages. They previously bundled their own copy, which meant two Effect instances in one process and services that could not find each other across the boundary.

- Five entry points that were never API are gone. Each existed because another
  package in this project found the code convenient, not because it was a surface
  anyone should depend on.

  What is left is documented: an entry point is a name you may import and we may
  not move without a major, and everything else is internal whatever file it sits
  in.

- Reporters are constructed by a factory and provided as a layer.

  The exported reporter classes are gone. Replace each `new` with the matching
  factory — `makeClearTextReporter`, `makeHtmlReporter`, `makeJsonReporter`,
  `makeProgressBarReporter`, `makeProgressStreamReporter`.

  Each factory takes the reporter's own options rather than an injected container,
  and each operation returns an `Effect`. If you registered a reporter as a plugin,
  declare it with `declarePlugin` and hand over a layer that provides `Reporter`.

  `drawClearTextScoreTable` is now exported for anyone rendering the score table
  outside a reporter.

### Patch Changes

- New version is published through npm trusted publishing, so it carries a provenance attestation you can verify.

- Peer Effect requirement advances to 4.0.0-rc.112. No API changes.

- A mutation run writes the JSON report the `json` reporter is configured to produce.

  Vitest no longer reprints its full summary for every mutant.

- Each of these packages now has a README, so its registry page says what the package is, how
  to install it, and what to import or register — previously the page was blank. The lint
  plugins show the configuration line that enables what they recommend.

  `@systemfsoftware/stryker-js-html-reporter` also carries its licence text

- Published packages no longer carry build artifacts left over from earlier builds. One package was shipping about a megabyte of bundled test-runner internals this way.

- Updated dependencies:
  - @systemfsoftware/stryker-js@2.0.0

## 1.0.0

### Major Changes

- Report generation moved to a plain kernel; the reporter service shape is unchanged

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@6.0.0
  - @systemfsoftware/stryker-js@1.0.0

## 0.1.2

### Patch Changes

- Refreshed builds on the platform-services dependency graph; the packages no longer reach for host builtins directly. No CLI flags or option names change.

- Updated dependencies:
  - @systemfsoftware/stryker-js@0.2.0

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

- effect is now a required peer dependency. Install it alongside these packages. They previously bundled their own copy, which meant two Effect instances in one process and services that could not find each other across the boundary.

- Five entry points that were never API are gone. Each existed because another
  package in this project found the code convenient, not because it was a surface
  anyone should depend on.

  - The engine's version and its engine range now come from the package's own
    entry point.
  - The failure identities you catch come from that same entry point rather than a
    separate one.
  - `toRelativeNormalizedFileName` comes from there too.
  - A timer, and a barrel of plugin internals, are no longer reachable. Report's
    `makeEmptyTimer` is gone with them; a progress tally now carries the instant
    the run started rather than a timer object.

  What is left is documented: an entry point is a name you may import and we may
  not move without a major, and everything else is internal whatever file it sits
  in.

- Reporters are constructed by a factory and provided as a layer.

  The exported reporter classes are gone. Replace each `new` with the matching
  factory — `makeClearTextReporter`, `makeHtmlReporter`, `makeJsonReporter`,
  `makeProgressBarReporter`, `makeProgressStreamReporter`.

  Each factory takes the reporter's own options rather than an injected container,
  and each operation returns an `Effect`. If you registered a reporter as a plugin,
  declare it with `declarePlugin` and hand over a layer that provides `Reporter`.

  `drawClearTextScoreTable` is now exported for anyone rendering the score table
  outside a reporter.

### Patch Changes

- New version is published through npm trusted publishing, so it carries a provenance attestation you can verify.

- A mutation run writes the JSON report the `json` reporter is configured to produce.

  Vitest no longer reprints its full summary for every mutant.

- Each of these packages now has a README, so its registry page says what the package is, how
  to install it, and what to import or register — previously the page was blank. The lint
  plugins show the configuration line that enables what they recommend.

  `@systemfsoftware/stryker-js-html-reporter` also carries its licence text

- Published packages no longer carry build artifacts left over from earlier builds. One package was shipping about a megabyte of bundled test-runner internals this way.

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@5.0.0
