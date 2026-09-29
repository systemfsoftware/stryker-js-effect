---
"@systemfsoftware/stryker-js": minor
---

With `--incremental`, an unchanged project now skips the initial test run; that run otherwise executes the suite twice to find flaky tests, and a verdict that depends on a flaky test, or any static mutant while a test is flaky, is re-tested instead of reused.
