## 8.0.0

### Major Changes

- Counts and durations that cannot be negative are refined where they are declared, through the shared non-negative integer and non-negative finite schemas. Test-runner counts and durations, the clear-text reporter's log limit, the dry-run timeout, a test run's hit counter and limit, and a run's help-error count now refuse a negative value instead of accepting it.

- Test identifiers are one value: `TestRunner.TestId`, a non-empty branded string carrying the runner's `file#test name` form. Test runner results, report test definitions, a mutant's killers and coverers, per-test hit records, and the test-contribution evaluation all speak that one type instead of bare strings.

  Mint one with `TestRunner.TestId.make(...)` where a runner derives a test id; the machine stream and mutation report schemas brand the ids they decode.

### Patch Changes

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.
