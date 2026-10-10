---
"@systemfsoftware/stryker-js": major
---

`stryker plan --since <ref>` plans only the mutants on lines changed since a git ref. A `since` in the config file scopes the plan the same way, and every project is staged with the one diff the plan records. The plan file is now version 2 and records its scope: `Unscoped`, `DiffScoped` with the merge base and HEAD, or `FullScope` with the reason it widened. `run --plan --shard` exits 2 on a scoped plan at any other HEAD. A plan this engine cannot decode, such as version 1, exits 2 with the code `plan-undecodable` and the next step `stryker plan --since <base>`. An unknown `--since` ref exits 2. `GitDiff` gains `head`, its paths are relative to the working directory, and `GitDiff.layer` requires `Path.Path`. `GitDiffSchema` adds `PlannedDiff`.
