## 7.1.0

### Minor Changes

- Each run stage, checker call, report write and test-runner mutant run now records an OpenTelemetry span named after its cell. The span has `.read` and `.write` child spans and an `app.<name>.decision` or `app.<name>.failure` attribute holding the outcome. It also feeds an `app.<name>.duration` histogram labelled `result_class`.

### Patch Changes

- The checker now applies each mutant at the position the mutant reports, since
  those positions are 1-based lines. A mutated line other than the first was
  previously rewritten further down the file, so the checker compiled something
  other than the mutant it was given and could report the wrong verdict for it.

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@9.0.0
  - @systemfsoftware/stryker-js-plugin-interface@8.0.0
  - @systemfsoftware/stryker-js-plugin-runtime@6.0.0
