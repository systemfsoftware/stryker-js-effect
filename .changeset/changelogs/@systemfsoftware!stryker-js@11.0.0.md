## 11.0.0

### Major Changes

- Each package's main entry point now groups its exports into namespaces named after a capability, such as `Plugin`, `TestRunner` and `Report`.

  - Import the namespace and qualify each name, for example `Plugin.TestRunnerRpcs` after importing `Plugin` from the plugin interface.
  - Import instrumenter schemas such as `Location` and `MutantStatus` from the instrumenter's `Mutant` namespace, and plugin-interface names from the plugin interface, instead of through another package's entry point.
  - The engine's `/config`, `/events` and `/promises` entry points are unchanged.

- Configuration helpers move onto `StrykerConfig`, and internal helpers leave the package entry point.

  - Replace `defineConfig(…)` with `StrykerConfig.define(…)` and `mergeConfig(…)` with `StrykerConfig.merge(…)`, imported from the `./config` entry point.
  - Replace `createDefaultOptions`, `defaultOptions`, `SUPPORTED_CONFIG_FILE_NAMES` and `CONFIG_SYNTAX_HELP` with the `StrykerConfig` statics `createDefaultOptions`, `defaultOptions`, `supportedFileNames` and `syntaxHelp`.
  - Replace `calculateMetrics` with a decode through `MetricsResultFromReport`.
  - Remove imports of the other dropped helpers, such as `resolveExitCode`, `buildVerdictEnvelope`, `makeRunLayer` and the checker metric instruments. They have no public replacement.

- `Engine.strykerCell` now leaves the Node platform services to the caller, `createFileMatcher` and `matchesFile` are replaced by `Configuration.FileMatcher`, and the entry point no longer re-exports `effect/Schema` as `S`.

  - Build a matcher with `FileMatcher.make({ pattern, allowHiddenFiles })` and call `matcher.matches(pathService, fileName)`.
  - Import `effect/Schema` directly where you used `S`.
  - Provide `Engine.nodePlatformLayer` to `Engine.strykerCell`, for example with `Effect.provide`.

- Framework format support now arrives as a plugin. A package exporting `strykerFrameworks` and listed in `plugins` teaches a run new file formats — the Angular and Svelte plugins ship for `.html`, `.htm`, `.vue`, and `.svelte`. List each framework package by name: a bare package name resolves from the project, and a `file://` URL keeps working. There is no discovery, so a plugin you never list contributes nothing.

  When two plugins claim one extension, the one listed first in `plugins` owns it, and the losing claim is reported with the winning and losing module names.

  The `Framework` type a plugin's `strykerFrameworks` entries satisfy, and the AST `Node` type an ignorer's `shouldIgnore` receives, are exported beside `Ignorer`.

- A framework plugin that cannot serve refuses the run before any file is instrumented. A missing peer, a peer installed outside the plugin's supported range, a peer that does not export what the plugin needs, or a contribution that fails validation ends the run as a configuration error (exit code 2); a plugin module that crashes on import stays an internal error (exit code 4).

  An unclaimed file is skipped instead of failing the run. The skip report names its extension and the installed package whose manifest claims that extension, so the fix is adding that package to `plugins` — or installing a framework plugin when no installed package declares the extension. A file a loaded format claims but cannot parse still fails the run.

- A report now labels each file with the language of the format that owns it, instead of the extension table the core used to carry, so a component a framework plugin claims is reported under that plugin's language.

  Incremental runs reuse a file's remembered results only while the owner stamp of the format that owns it is unchanged — the module the format is registered from joined with the version of the framework runtime that plugin resolved. Upgrading either recomputes that file's mutants rather than reusing results the new runtime never produced. A file no loaded format claims is never remembered, so configuring the format that owns it mutates the file on the next run.

- The machine-mode stream gains three event kinds: the framework each configured plugin module contributed, the resolved format registry mapping every claimed extension to its format and owning module, and the files skipped for want of a format. `RunFailed` gains a typed `reason` naming what ended the run, so a refusal reads without parsing prose.

  `STREAM_SCHEMA_VERSION` is now `1.1`. A decoder that switches over the event kinds must handle the new members before it upgrades.

### Minor Changes

- Each run stage, checker call, report write and test-runner mutant run now records an OpenTelemetry span named after its cell. The span has `.read` and `.write` child spans and an `app.<name>.decision` or `app.<name>.failure` attribute holding the outcome. It also feeds an `app.<name>.duration` histogram labelled `result_class`.

- A `--survivors` run now reports a prior report as mismatched when a surviving mutant has an empty id or mutator name, or a file name containing a backslash.

### Patch Changes

- The JSON report and the machine stream now name the same place for every
  mutant. The report's columns ran one too high, and the stream's line and column
  ran one and two too high, so a consumer that highlighted the mutated code from
  either landed beside the mutation. Both now carry the mutant's 1-based line and
  column.

  An incremental run keeps reusing the results remembered in a report written
  before this fix, so upgrading does not re-run a project's mutants once.

- Incremental runs and the verdict envelope now handle mutant ids and file names that match built-in object properties, such as `toString`.

- Updated dependencies:
  - @systemfsoftware/stryker-vm-harness@2.0.0
