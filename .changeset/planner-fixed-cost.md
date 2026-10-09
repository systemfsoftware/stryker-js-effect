---
"@systemfsoftware/stryker-js": minor
---

`stryker plan` now prices each shard's fixed cost. A shard pays start-up, instrumenting, and worker and checker boot for every project it holds, on top of its mutants and its dry run, and the planner left that out. A run now records the seconds it spent beyond its fresh dry run and its mutants' recorded costs as `fixedSeconds` in the incremental record, never below zero. `stryker merge` averages that value over the shards. The planner adds the recorded value for each project a shard holds, or 20 s per project when no record carries one. Plans now predict more seconds per shard and can choose more shards for the same `--target-seconds`.
