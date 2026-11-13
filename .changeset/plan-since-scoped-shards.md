---
"@systemfsoftware/stryker-js": major
---

`stryker plan --since <ref>` plans only the mutants on lines changed since a ref, recording scope `Unscoped`, `DiffScoped` (merge base, HEAD, file digest) or `FullScope`. `run --plan --shard` runs those mutants, exiting 2 at another HEAD, when a scheduled file changes, or a scheduled mutant is undiscoverable (a config edit), naming the plan and the missing ids; the plan file and unrelated edits never matter. `run --plan <file>` without `--shard` exits 2 naming `--shard` and the next action. Undecodable plans, unknown refs and failed git commands exit 2, naming `plan-undecodable` and next `stryker plan --since <base>`. `GitDiff` gains `head`, `toplevel` and `sourceDigest`; `changedSince` returns `hunks[].file` and `untrackedFiles` relative to the requested directory; `GitDiff.layer` requires `ChildProcessSpawner` and `Path.Path`; `GitDiffSchema` adds `PlannedDiff`.
