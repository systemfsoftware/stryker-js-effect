---
"@systemfsoftware/stryker-js": major
---

Every mutation and incremental run now records a `budget` of predicted and actual seconds on its machine verdict line and in its mutation and incremental reports, derived from the measured cost of the mutants it scheduled and the wall time the run took. `stryker gate` takes `--budget-baseline <file>`, an optional `--budget-tolerance` (default 0.25), and `--update-budget-baseline`; it fails with exit 1 when the finished run's actual seconds exceed the committed baseline by more than the tolerance, naming both numbers, and rewrites the baseline with the current run when updating.
