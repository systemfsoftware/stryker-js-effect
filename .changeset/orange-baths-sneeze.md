---
"@systemfsoftware/stryker-js": patch
---

Counting ignored mutants by rule reads the decoded ignore reason's `code` field again, so the package builds after the rename from `ruleId`.
