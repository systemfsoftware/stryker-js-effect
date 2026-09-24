## 7.2.0

### Minor Changes

- Each run stage, checker call, report write and test-runner mutant run now records an OpenTelemetry span named after its cell. The span has `.read` and `.write` child spans and an `app.<name>.decision` or `app.<name>.failure` attribute holding the outcome. It also feeds an `app.<name>.duration` histogram labelled `result_class`.

### Patch Changes

- Tests inside `describe` blocks now kill the mutants they cover. A nested test's full name joins its suite levels with `" > "`, but the test ids this runner stored and matched a mutant's run against joined the levels with a plain space, so the selection matched nothing for any test nested in a suite and the mutant was reported as survived — mutation scores came out lower than the tests justified. Killed-by and covered-by test names in reports now use full test names, with `" > "` between suite levels.
