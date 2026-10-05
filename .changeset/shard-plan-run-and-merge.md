---
"@systemfsoftware/stryker-js": major
---

The `merge-reports` command becomes `merge`, which now reads the shard plan and the per-shard report directories and combines them into one mutation report and one incremental report. A merge fails, naming the mutants, when a planned mutant is missing from its shard report or reported by two shards. A new shard mode runs exactly the mutants of one shard, spawning a child run per project the shard lists, so a plan can be executed across parallel jobs and merged afterwards; mutants outside a shard are neither run nor reported.
