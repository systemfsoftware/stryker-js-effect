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
