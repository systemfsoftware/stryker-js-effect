---
"@systemfsoftware/stryker-js": major
---

The incremental report and its checkpoints now record a `costs` entry for every mutant: the predicted milliseconds from the measured dry-run times of its covering tests plus the run's fixed overhead, the wall time of its last executed run, and its covering-test count. A verdict reused from an earlier run carries its recorded `actualMs` forward instead of losing it. The incremental cache layout moves to version `3`, so a report written by an earlier release is discarded rather than reused.
