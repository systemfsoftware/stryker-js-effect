---
"@systemfsoftware/stryker-ignorer-in-source-vitest-block": minor
---

First release. This ignorer keeps mutants inside a test-only block out of a
mutation run: those statements never reach the production path, so no run can
observe the change.

It has no runtime dependencies, and migrating from the plugin you use today is a
rename in your plugins list — the ignorer keeps the name it already had.
