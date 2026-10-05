---
"@systemfsoftware/stryker-js": patch
---

Mutants no test covers are now verified by the configured checkers before they are reported `NoCoverage`. A checker that rejects such a mutant reports it `CompileError`, with the checker's reason, instead of `NoCoverage`; uncovered mutants that pass every checker are still reported `NoCoverage`. Previously the checkers never saw uncovered mutants, so a non-compiling mutant no test reaches counted as an undetected survivor.
