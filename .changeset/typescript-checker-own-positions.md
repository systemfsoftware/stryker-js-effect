---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

A `CompileError` reason now names the line and column where the error sits in that mutant's own code. When several mutants were checked together, an earlier mutant's reason could point at a position computed from a later mutant's code, so the reported line was wrong.
