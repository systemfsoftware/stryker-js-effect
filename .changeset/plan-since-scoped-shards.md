---
"@systemfsoftware/stryker-js": major
---

`stryker plan --since <ref>` plans only the mutants on lines changed since a git ref, with the same diff rules as `run --since`. The plan file is now version 2 and records its scope: `Unscoped`, `DiffScoped` with the merge base and HEAD, or `FullScope` with the reason it widened. `run --plan --shard` refuses a scoped plan at any other HEAD with exit code 2, so plan again after committing. An unknown `--since` ref now exits 2. `GitDiff` gains `head`, and its hunk and untracked paths are relative to the working directory.
