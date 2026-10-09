# @systemfsoftware/stryker-js-vitest-runner

## 9.0.1

Only the package manifest changes: the development dependencies on stryker-js, its runner, its checker and the two ignorers now name the released tarballs instead of the npm `latest` tag. Runtime code, dependencies and peer dependencies are unchanged.

## 9.0.0

The dry run now reports, as `testFileModules`, the modules each test file evaluated, including modules it imported at runtime through a computed `import()`. Mutant runs are unaffected. On Vitest setups where this information is not available, the field is left out. Effect moves to `4.0.0-rc.117`, together with the `@effect/*` packages these libraries use. Projects that install `effect` next to them need the same release.

- The TypeScript checker and test-runner workers now bundle their own runtime, so the only modules they load from your project are the TypeScript compiler and your test framework.
- The test-runner plugin supports the framework's fifth major release.
- The ignorer interface re-exports the `oxc-parser` 0.150 AST, in which `FormalParameterRest.decorators` is `Array<Decorator>`. Vitest 4 is no longer supported: the `vitest` peer dependency is now `^5`. Upgrade your project to Vitest 5 before upgrading this package.

## 8.1.1

### Patch Changes

- A mutant's timeout now starts when its first test begins, not when the test runner is asked to run it. With a short `timeoutMS`, a mutant its tests would kill is reported `Killed` instead of `Timeout`, so a slow or busy machine no longer changes the verdict. A mutant whose tests never begin still ends, on the same window that bounds a plugin worker which never accepts its connection.

  If you author a test-runner plugin, `mutantRun` now streams its run: emit `MutantRunStarted` before the runner's first test begins, then `MutantRunSettled` carrying the result.

## 8.1.0

### Minor Changes

- The Vitest runner persists transformed modules to a file-system cache under the sandbox and reuses them across the worker threads the standby pool hands out, so a mutant run that lands on a freshly handed-out thread reads the transforms it already paid for instead of recompiling every module. The cache can be turned off with `testRunner: { options: { fsModuleCache: false } }`. Verdicts are unchanged.

### Patch Changes

- The runner no longer lets the ambient `VITEST_MAX_WORKERS` setting raise the number of Vitest workers it runs with, which could start a mutant's covering tests concurrently; with that setting in the environment, a previously recorded killer still runs first and a killed mutant stops at its killer.

## 8.0.3

### Patch Changes

- Effect moves to the stable `4.0.0` release, together with the `@effect/*` packages these libraries use. The `4.0.0` release candidates are no longer supported: install `effect` `^4.0.0` next to these packages before upgrading.

  The TypeScript checker and test-runner plugins bundle their own Effect runtime, so they need no change in your project.

## 8.0.2

### Patch Changes

- Fixed a rare hang where a run stopped making progress while a test runner or checker worker waited for a message that had already arrived. The message now always wakes the worker waiting for it.

## 8.0.1

### Patch Changes

- The packages now depend on `@systemfsoftware/effect-cell-types` 11.

  - Every tagged error now has a one-line message built from its fields, so a failure names the file, mutant, plugin, worker or exit code involved instead of an empty message. The errors' tags, fields and encoded forms are unchanged.

## 8.0.0

### Major Changes

- Counts and durations that cannot be negative are refined where they are declared, through the shared non-negative integer and non-negative finite schemas. Test-runner counts and durations, the clear-text reporter's log limit, the dry-run timeout, a test run's hit counter and limit, and a run's help-error count now refuse a negative value instead of accepting it.

- Test identifiers are one value: `TestRunner.TestId`, a non-empty branded string carrying the runner's `file#test name` form. Test runner results, report test definitions, a mutant's killers and coverers, per-test hit records, and the test-contribution evaluation all speak that one type instead of bare strings.

  Mint one with `TestRunner.TestId.make(...)` where a runner derives a test id; the machine stream and mutation report schemas brand the ids they decode.

### Patch Changes

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.

## 7.3.0

### Minor Changes

- The test runner accepts a new `pool` option. When it is `threads`, a Vitest config that enables browser mode for any project is refused at startup with a message naming `testRunner: 'vitest'`.

### Patch Changes

- A run whose selected files produce no mutants, for example because no loaded framework claims them, now runs every test in the dry run and finishes with an empty report. With `testRunner: 'vm'` or `'vitest'` it used to fail with "No tests were executed", because the dry run only looked for tests related to those files. The dry run now relates tests only to the files that carry mutants.

- A failed dry run now names every failing test. The runner used to apply the bail setting to the dry run as well, so Vitest stopped at the first failure and the error listed only that test. Mutant runs still stop at the first failing test unless `disableBail` is set.

- A test file that fails as a whole — a suite that registers no tests, a file that throws while loading, or a `beforeAll`/`afterAll` hook that fails — is now reported as a failing test carrying the file's own message. A mutant that breaks a file this way is reported as Killed instead of Surviving, and a dry run that loads such a file fails naming it.

  Skipped tests that never start are now reported as skipped rather than dropped from the run's results.

  A mutant run whose related files match no test file no longer stops with a test-runner crash; the run continues with no test able to kill the mutant.

- Mutation runs with `testRunner: 'vm'` finish in about half the time, with the same verdicts. The engine checks mutant groups on every checker process at once, stops the checkers as soon as checking ends, hands their share of `concurrency` to the test runners, and shares a Node compile cache with every worker it starts. The Vitest runner starts the next isolated worker thread while the current test file runs, so each file still gets a fresh thread but no longer waits for one to boot. On a 319-mutant TypeScript project with the TypeScript checker, a run went from 24.9 s to 12.6 s.

## 7.2.1

### Patch Changes

- The packages now build on the latest `@systemfsoftware/effect-cell-types` 10.2 cell kinds, with no change to their published behavior.

  - `@systemfsoftware/stryker-test-contribution` exports its evaluator as `Judge`, `TestContribution`, and `TestContributionEvaluator`, and now depends on `effect` directly.

## 7.2.0

### Patch Changes

- Mutant runs now execute the tests that cover the mutant and report the verdict those tests earn. With the default `related` option, every mutant run filtered out all test files, so mutants came back as errors (`No test files found`) instead of killed or survived. Mutants covered only by tests inside `describe` blocks — any depth, including `describe.each` — now run exactly those covering tests and are reported Killed when any of them fails; mutants covered only by top-level tests keep their existing selection and verdicts.

## 7.1.1

### Patch Changes

- Exported declarations that previously took `unknown` now take a defaulted type parameter: calls that omit the type argument are unchanged, and calls that were previously rejected for passing an unconstrained value are accepted. No runtime behaviour changes.

## 7.1.0

### Minor Changes

- A finite mutant is killed or survived from its tests. Timeout is reserved for one named nonterminating trap, detected by a hit bound rather than a wall-clock budget. A wall-clock timeout fails the run instead of being stored as a detected mutant.

### Patch Changes

- Mutants that execute far past their dry-run hit count now fail at the hit limit instead of waiting out the test timeout. Coverage from the dry run is recorded again, so the limit is armed.

## 7.0.1

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

## 7.0.0

### Major Changes

- The runner now requires vitest 4.1 or later, and the peer dependency says so:
  `vitest >=4.1.0`.

  Upgrade vitest to 4.1 or later before upgrading this package. Projects that must
  stay below 4.1 should stay on the previous release.

  The published bundle now also inlines `oxc-parser` and `@eslint-community/regexpp`
  so they ship inside the runner's install. Consumers that previously resolved those
  packages as transitive dependencies from another tool should now take them from
  the runner's published bundle.

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

## 5.0.0

### Major Changes

- Every module Stryker loads — config files, `extends` targets, plugins, and the vitest runner's own vitest — now resolves and imports through Node's native ECMAScript module system: `import.meta.resolve` resolves each bare specifier from the consuming module, and dynamic `import()` loads the resolved URL. The package's `exports` map (or a legacy `main`) selects the entry file, ESM-only plugin packages load, and no require-based loader ships in any package. An unresolvable bare specifier warns with a machine-readable reason; the run fails at prepare only when nothing provides the configured runner or checker. Node.js 22.18.0 or later is required.

  To migrate, install Node.js 22.18.0 or later. Bare plugin specifiers keep working, but a plugin package must publish an ES module entry through `exports` or `main`, and the plugin must be resolvable from where Stryker itself is installed.

- The plugin system now runs each configured TestRunner/Checker/Reporter plugin in its own spawned process over an @effect/rpc wire: plugins load from the project's config-declared specifiers (no glob discovery), boundary failures are typed errors, and plugin spans link into the host trace. Breaking: the in-process plugin Layer contract is removed.

### Patch Changes

- Maintenance release. Every published entry point, export, option, and behaviour is exactly as it was.

- effect peer range widens to ^4.0.0-rc.112; repository metadata now points at stryker-js-effect

- The worker environment now arrives on the spawn params instead of mid-init self-mutation, and the setup filename uses a uuid instead of the process id.

## 4.0.4

### Patch Changes

- Imports rewired to the collapsed `@systemfsoftware/stryker-js` root entry; each package now co-releases against the root-entry major.

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@8.0.0
  - @systemfsoftware/stryker-js@4.0.0

## 4.0.3

### Patch Changes

- Releases the workspace so its published versions track the shared dependency graph this change moves.

- The `@systemfsoftware/source` export condition is gone. It resolved to a package's TypeScript sources for editors and in-repo typechecks; each package now exports only its built entry. If your tsconfig sets `customConditions: ["@systemfsoftware/source"]`, or a bundler config names that condition, remove it — resolution falls back to the built entry, which is what every consumer already got.

## 4.0.2

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@7.0.0

## 4.0.1

### Patch Changes

- Re-released against @systemfsoftware/stryker-js without the removed --llms manifest. The Run stream no longer carries a manifest terminal event, and the RunEvent / RunTerminalEvent unions no longer include the manifest arm, so any exhaustive consumer of those types must drop that case.

- Rebuilds against updated workspace dependencies, including the new
  `@systemfsoftware/stryker-js` reporter protocol major.

- Updated dependencies:
  - @systemfsoftware/stryker-js@3.0.0

## 4.0.0

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

### Minor Changes

- Machine-readable mutation progress is a newline-delimited JSON file next to the HTML and JSON reports, not the console.

  The console prints bounded progress prose: phase names, a count line, at most twenty surviving mutants, and a verdict. Killed mutants now advance that count. Child test runs during mutation no longer print per-test output or GitHub workflow commands.

  If you parsed the console as JSON lines, read the stream file instead. A hard kill can leave that file without a closing verdict line.

### Patch Changes

- New version is published through npm trusted publishing, so it carries a provenance attestation you can verify.

- Peer Effect requirement advances to 4.0.0-rc.112. No API changes.

- A mutation run writes the JSON report the `json` reporter is configured to produce.

  Vitest no longer reprints its full summary for every mutant.

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

## 3.0.0

### Major Changes

- The dry-run decision moved to a plain kernel (dryRunCell removed); the mutant-run decision splits into branded MutantKilled|MutantSurvived|MutantTimeout|MutantDryError variants

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@6.0.0
  - @systemfsoftware/stryker-js@1.0.0

## 2.1.0

### Minor Changes

- Plugin code can now ask for the module-loader service instead of touching the host module API: it exposes the same `createRequire`/`isBuiltin` surface as the host module module, and the Node engine supplies it automatically. Plugins that declare their environment through the engine's plugin declaration get the service without extra wiring; upgrades should move the engine and its plugins in the same release.

### Patch Changes

- Refreshed builds on the platform-services dependency graph; the packages no longer reach for host builtins directly. No CLI flags or option names change.

- Updated dependencies:
  - @systemfsoftware/stryker-js@0.2.0

## 2.0.2

### Patch Changes

- Re-published against the oxc-based instrumenter: workspace dependency ranges move to the new instrumenter major; no package's own behavior changes in this release.

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

### Minor Changes

- Machine-readable mutation progress is a newline-delimited JSON file next to the HTML and JSON reports, not the console.

  The console prints bounded progress prose: phase names, a count line, at most twenty surviving mutants, and a verdict. Killed mutants now advance that count. Child test runs during mutation no longer print per-test output or GitHub workflow commands.

  If you parsed the console as JSON lines, read the stream file instead. A hard kill can leave that file without a closing verdict line.

### Patch Changes

- A mutation run writes the JSON report the `json` reporter is configured to produce.

  Vitest no longer reprints its full summary for every mutant.

- Updated dependencies:
  - @systemfsoftware/effect-cell-types@5.0.0

## 1.0.0

### Major Changes

- effect is now a required peer dependency. Install it alongside these packages. They previously bundled their own copy, which meant two Effect instances in one process and services that could not find each other across the boundary.

### Minor Changes

- The Vitest runner accepts `setupFilePath`, naming the setup file it copies into
  the sandbox. It defaults to the file shipped beside the runner's own module,
  which is the right answer for an installed package; supply it only when you are
  running the runner from sources rather than from an install.

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

## 0.1.4

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

## 0.1.3

### Patch Changes

- Related mode now follows a published import of the package under test to the copy Stryker is mutating.

## 0.1.2

### Patch Changes

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

## 0.1.1

### Patch Changes

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
