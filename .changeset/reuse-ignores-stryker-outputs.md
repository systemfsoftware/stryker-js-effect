---
"@systemfsoftware/stryker-js": patch
---

Repeating an incremental run with no source change now reuses every verdict in a project that defines no ignore patterns of its own: a run's own reports are no longer treated as changed inputs, and options that cannot change a verdict no longer invalidate reuse — neither the ones that only select which mutants and tests run (a git ref scope, a single mutant id) nor reporting and logging options such as reporters, colors, thresholds, surfacing or log levels.
