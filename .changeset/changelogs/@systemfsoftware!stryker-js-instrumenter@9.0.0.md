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
