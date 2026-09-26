---
"@systemfsoftware/stryker-js": patch
---

A mutant whose test run exceeds the wall-clock timeout is now reported as `Timeout` (reason `wall-clock-timeout`) and the run continues with the remaining mutants. The hung test-runner worker is killed and replaced instead of aborting the whole run with exit code 4.
