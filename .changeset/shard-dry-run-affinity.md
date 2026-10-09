---
"@systemfsoftware/stryker-js": minor
---

A run now skips the initial test run when every mutant it holds was a CompileError last time and a checker is configured. The checkers settle those mutants first; the test run starts only if a checker accepts one of them, and that mutant is then scored exactly as a forced run scores it. A shard holding only CompileError mutants of a project no longer pays that project's dry run.

`stryker plan` now groups the mutants that need a project's dry run onto as few shards as the target allows, and each shard's `predictedSeconds` includes the dry runs that shard will execute fresh. A dry run the shard can reuse from the incremental report is priced at zero. Before, every shard holding any mutant of a project ran that project's dry run, and the plan did not count it.
