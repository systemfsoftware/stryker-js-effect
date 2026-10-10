---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

The README now states the TypeScript floor the checker enforces: TypeScript `>=7.0.0`, not 5.x. Older compilers were already refused at startup.

Correction to the 8.1.0 notes: files that import a mutated file are not checked "only when the mutant changes what that file exports". They are re-checked whenever the mutated file has no compile errors of its own, whatever the mutant changed.
