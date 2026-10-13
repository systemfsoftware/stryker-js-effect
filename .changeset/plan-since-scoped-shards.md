---
"@systemfsoftware/stryker-js": major
---

`stryker plan --since <ref>` plans only the mutants on lines changed since a git ref; a config-file `since` scopes it the same way. The plan file is version 2 and records its scope: `Unscoped`, `DiffScoped` with the merge base, HEAD and worktree, or `FullScope` with those and the widening reason. `run --plan --shard` exits 2 on a scoped plan at any other HEAD, and names the working tree when the checkout no longer holds the uncommitted and untracked content it was scoped from; keep the plan outside the checkout or ignored. An undecodable plan, an unknown `--since` ref and a failed git command exit 2, the first naming the code `plan-undecodable` and the next step `stryker plan --since <base>`. `GitDiff` gains `head` with paths relative to the working directory, and `GitDiff.layer` requires `ChildProcessSpawner.ChildProcessSpawner` and `Path.Path`. `GitDiffSchema` adds `PlannedDiff`.
