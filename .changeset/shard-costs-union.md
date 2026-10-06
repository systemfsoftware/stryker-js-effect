---
"@systemfsoftware/stryker-js": patch
---

A merged shard report now carries the cost record of every shard, so a later plan sees measured timings for all mutants. Previously only the first shard's costs survived the merge, and the mutants of every other shard fell back to their predicted cost whenever the next plan was derived.
