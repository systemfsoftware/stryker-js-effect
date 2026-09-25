---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

Mutants are now type-checked incrementally. Checking a mutant costs its own file and the files that import it — through a relative path, a path alias, or a re-export — instead of a full type check of every project the checker opens, so a run whose mutants all live in one file finishes instead of staying at zero completed mutants until the run is killed.

A mutation that breaks a file which imports the mutated file is still a `CompileError` rather than being handed to the test runner.
