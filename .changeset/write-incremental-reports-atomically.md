---
"@systemfsoftware/stryker-js": patch
---

The incremental report and its checkpoints are now written atomically: the bytes go to a temporary file in the same directory and are renamed over the target, so an interrupted or killed run (a job-cap timeout, or a process stopped while the report is being saved) can no longer leave a truncated incremental file behind. A run that finds a cache written this way decodes it and reuses it instead of discarding the whole mutation history. The mutation report, summary, and incremental report that `stryker merge` writes are saved the same way.
