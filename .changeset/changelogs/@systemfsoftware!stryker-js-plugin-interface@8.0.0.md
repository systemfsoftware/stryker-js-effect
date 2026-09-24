## 8.0.0

### Major Changes

- Each package's main entry point now groups its exports into namespaces named after a capability, such as `Plugin`, `TestRunner` and `Report`.

  - Import the namespace and qualify each name, for example `Plugin.TestRunnerRpcs` after importing `Plugin` from the plugin interface.
  - Import instrumenter schemas such as `Location` and `MutantStatus` from the instrumenter's `Mutant` namespace, and plugin-interface names from the plugin interface, instead of through another package's entry point.
  - The engine's `/config`, `/events` and `/promises` entry points are unchanged.

- Exit-code, timeout-reason and trace-context helpers are replaced by schemas and codecs.

  - Replace `EXIT_CODE` with the `ExitCodeFromClass` codec.
  - Replace the hit-limit and wall-clock helpers with `HitLimitReason`, `HitLimitReasonPrefix` and `WallClockTimeoutReason`.
  - Replace `formatTraceparent` and `parseTraceparent` with encoding and decoding through `Traceparent`, and the header constants with `TraceparentHeader` and `TracestateHeader`.
  - Build `CheckerMutantWire` values from the instrumenter's `MutantId`, `CanonicalFileName` and `MutatorName`.

### Minor Changes

- A plugin specifier now accepts a bare package name, with or without a subpath, in every option that takes one: `plugins`, `appendPlugins`, `ignorers`, a custom `testRunner.plugin`, and `checkers[].plugin`. `file://` URLs keep working.

### Patch Changes

- The position a checker receives for a mutant is now documented as 1-based
  coordinates — the first line of a file and the first character of a line both
  sit at the first position. A checker written against the earlier description,
  which called the coordinates 0-based, placed mutants one line away from the
  mutation.

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@9.0.0
