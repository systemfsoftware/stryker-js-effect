---
"@systemfsoftware/stryker-js": patch
---

`run --since` and `plan --since` widen a project to a full run only when a Stryker config, a test-runner config, a `package.json` or a lockfile changed in that project or in one of its ancestor directories. A change to those files in a sibling package no longer widens it. The diff is read with its output format pinned (`--no-color`, `--no-ext-diff`, `--no-textconv`, `--no-relative` and the `a/`/`b/` prefixes), so a user's git config can no longer empty or misplace the diff scope.
