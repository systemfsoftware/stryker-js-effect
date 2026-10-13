---
"@systemfsoftware/stryker-js": major
---

`stryker gate` now fails when a project's mutation score is below that project's own `thresholds.break`, as an unsharded run already did. `stryker merge` records each project's thresholds and files under a new `projects` field, so a merged sharded run fails where the unsharded run would; before, it passed.

A failing `stryker gate` exits `1` with reason code `score-below-break`: a count line, one line per failing project with its score and break, then the next action. It runs after the baseline and budget checks. A project with a break and no valid mutant, or whose shards recorded no thresholds, gets an info line instead of a verdict. A report with no `thresholds` is refused as unusable input.

Migration: raise the score, set each project's own `thresholds.break` to its current score, or set it to `null`.
