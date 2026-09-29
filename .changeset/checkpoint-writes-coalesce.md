---
"@systemfsoftware/stryker-js": patch
---

Incremental runs no longer hold a test runner while the checkpoint is rewritten after every mutant; the checkpoint is written in the background at most once per second, and an interrupted run still keeps every mutant it finished.
