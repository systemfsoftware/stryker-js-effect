## 6.0.0

### Major Changes

- Each package's main entry point now groups its exports into namespaces named after a capability, such as `Plugin`, `TestRunner` and `Report`.

  - Import the namespace and qualify each name, for example `Plugin.TestRunnerRpcs` after importing `Plugin` from the plugin interface.
  - Import instrumenter schemas such as `Location` and `MutantStatus` from the instrumenter's `Mutant` namespace, and plugin-interface names from the plugin interface, instead of through another package's entry point.
  - The engine's `/config`, `/events` and `/promises` entry points are unchanged.

- `partsOfEffectSpan` and `tracePartsOf` are replaced by the `TraceContextPartsFromEffectSpan` codec, which decodes an `EffectSpanIdentity`.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@8.0.0
