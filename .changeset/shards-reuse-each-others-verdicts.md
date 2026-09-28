---
"@systemfsoftware/stryker-js": patch
---

Incremental runs now reuse verdicts written under a different `incrementalFile`, `incrementalSources`, `tempDirName` or `cleanTempDir`, so a shard can reuse the verdicts another shard recorded for a file that moved between shards.
