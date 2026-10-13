---
"@systemfsoftware/stryker-js": major
---

`stryker plan --since <ref>` plans only the mutants on lines changed since a ref, like a config-file `since`, recording scope: `Unscoped`, `DiffScoped` (merge base, HEAD, file digest) or `FullScope` (plus a widening reason). `run --plan --shard` runs those mutants, exiting 2 at another HEAD, once a scheduled file changes, or a scheduled mutant is undiscoverable (a config edit), naming the plan and the missing ids; the plan file and unrelated edits never matter. Undecodable plans, unknown refs and failed git commands exit 2, naming `plan-undecodable` and next `stryker plan --since <base>`. `GitDiff` gains `head`, `toplevel` and `sourceDigest`; `changedSince` returns `hunks[].file` and `untrackedFiles` relative to the requested directory (hunks were root-relative, root runs unchanged); `GitDiff.layer` requires `ChildProcessSpawner` and `Path.Path`, and `GitDiffSchema` adds `PlannedDiff`.
