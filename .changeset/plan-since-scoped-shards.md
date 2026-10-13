---
"@systemfsoftware/stryker-js": major
---

`stryker plan --since <ref>` plans only the mutants on lines changed since a git ref; a config-file `since` scopes it the same way. The plan records its scope: `Unscoped`, `DiffScoped` with the merge base, HEAD and a source digest over the files it schedules mutants in, or `FullScope` with those and the widening reason. `run --plan --shard` exits 2 on a scoped plan at any other HEAD, and when a file the plan schedules mutants in has changed since planning; the plan file itself and unrelated edits never matter. An undecodable plan, an unknown `--since` ref and a failed git command exit 2, the first naming the code `plan-undecodable` and the next step `stryker plan --since <base>`. `GitDiff` gains `head`, `toplevel` and `sourceDigest`; `GitDiff.layer` requires `ChildProcessSpawner.ChildProcessSpawner` and `Path.Path`. `GitDiffSchema` adds `PlannedDiff`.
