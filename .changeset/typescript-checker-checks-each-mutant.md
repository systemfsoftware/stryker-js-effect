---
"@systemfsoftware/stryker-js-typescript-checker": major
---

The TypeScript checker now type-checks each mutant on its own, so a mutant is `CompileError` only when that mutant fails to compile, and checking finishes much sooner on large projects. Files that import a mutated file are checked only when the mutant changes what that file exports.

The `prioritizePerformanceOverAccuracy` option is removed. Delete it from your `checkers` options.
