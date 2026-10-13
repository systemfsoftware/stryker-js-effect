---
"@systemfsoftware/stryker-js": major
---

`stryker plan --since <ref>` plans only the mutants on lines changed since a git ref, like a config-file `since`. It records its scope: `Unscoped`, `DiffScoped` with the merge base, HEAD and a digest of its files, or `FullScope` with those plus a widening reason. `run --plan --shard` runs exactly those mutants and exits 2 at another HEAD or once a scheduled file changes; the plan file and unrelated edits never matter. An undecodable plan, an unknown `--since` ref and a failed git command exit 2, naming `plan-undecodable` and next `stryker plan --since <base>`. `GitDiff` gains `head`, `toplevel` and `sourceDigest`, and `changedSince` now returns `hunks[].file` and `untrackedFiles` relative to the requested directory (hunks were root-relative before; root runs are unchanged); `GitDiff.layer` requires `ChildProcessSpawner` and `Path.Path`, and `GitDiffSchema` adds `PlannedDiff`.
