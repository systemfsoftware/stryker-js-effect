---
"@systemfsoftware/stryker-js": major
---

`stryker gate` now fails when a project's mutation score is below that project's own `thresholds.break`, as an unsharded run already did. `stryker merge` records each project's thresholds and files in the merged report under a new `projects` field, so a sharded run that merges and gates fails exactly where the unsharded run would. Before, a sharded run below its break passed: each shard exits 0 and the merged report had lost the break.

A failing `stryker gate` exits `1` with reason code `score-below-break`. Its first line counts the projects below their break, then one line per failing project gives its score and break, then the next action. This check runs after the baseline and budget checks. A project with no valid mutant gets no verdict.

Migration: raise the score, or set `thresholds.break: null` to turn the verdict off.
