---
"@systemfsoftware/stryker-js-cli-contract": minor
---

The contract package now exports the shard plan schema: the versioned document a planner emits and a sharded run consumes, describing each shard's projects and the mutant ids it must run. A plan is refused when two shards share a label, because `--shard k/N` could not tell them apart.
