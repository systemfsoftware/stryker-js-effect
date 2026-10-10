---
"@systemfsoftware/stryker-js": major
---

`stryker gate` now fails when a project's mutation score is below that project's own `thresholds.break`, as an unsharded run already did. `stryker merge` records each project's thresholds and files in the merged report under a new `projects` field, so a merged sharded run fails exactly where the unsharded run would. Before, it passed: each shard exits 0 and the merged report lost the break.

A failing `stryker gate` exits `1` with reason code `score-below-break`: a count line, one line per failing project with its score and break, then the next action. This check runs after the baseline and budget checks, so an updated baseline is written first. A project with no valid mutant, or whose shards recorded no thresholds, gets no verdict and an info line saying why.

Migration: raise the score, set each project's own `thresholds.break` to its current score, or set it to `null`.
