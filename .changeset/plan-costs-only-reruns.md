---
"@systemfsoftware/stryker-js": patch
---

A shard plan now prices only the mutants a run will actually execute: mutants the incremental cache will reuse are planned at zero cost instead of their previous run time, so an unchanged project plans a single shard with zero predicted seconds. The plan still lists every mutant, so sharded runs keep reporting the full mutant set.
