---
"@systemfsoftware/stryker-js": patch
---

An incremental run now keeps a mutant's previous verdict when the files its covering tests can reach are unchanged, even though other files in the project changed. Editing an unrelated source file no longer re-runs verdicts it cannot affect: a verdict is discarded only when a file the mutant's covering tests can import — including sources reached through a workspace link — has itself changed. A setup file the runner reports from inside `node_modules` is hashed into the closures it feeds instead of making every verdict suspect, while installed packages stay covered by the lockfile and the package manifest.
