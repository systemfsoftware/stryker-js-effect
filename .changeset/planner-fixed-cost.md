---
"@systemfsoftware/stryker-js": minor
---

`stryker plan` now prices each shard's fixed cost. A shard pays start-up, instrumenting, and worker and checker boot for every project it holds, on top of its mutants and its dry run, and the planner left that out. A run now records that cost as `fixedSeconds` in the incremental record: the time from its start until its first mutant is scored, minus its fresh dry run and that mutant's own cost, never below zero. A run that scores no mutant records nothing. `stryker merge` averages the value over the shards. The planner adds the recorded value for each project a shard holds, or 20 s per project when no record carries one. Plans now predict more seconds per shard and can choose more shards for the same `--target-seconds`.
