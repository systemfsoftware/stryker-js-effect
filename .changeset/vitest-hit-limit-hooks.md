---
"@systemfsoftware/stryker-js-vitest-runner": patch
---

Mutants that execute far past their dry-run hit count now fail at the hit limit instead of waiting out the test timeout. Coverage from the dry run is recorded again, so the limit is armed.
