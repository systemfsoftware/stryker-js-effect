---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

The checker no longer reports a mutant as `CompileError` when the compile error could come from another mutant checked in the same group; such mutants are checked again on their own and keep their real status.
