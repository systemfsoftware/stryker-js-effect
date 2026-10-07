---
"@systemfsoftware/stryker-js": minor
"@systemfsoftware/stryker-js-cli-contract": minor
---

An incremental run now reuses the verdicts of mutants a checker rejected as
`CompileError`, instead of type-checking every one of them again. A remembered
`CompileError` is kept only while nothing that fed the check has changed: the
mutant's own identity and replacement, every file the checker's TypeScript
program loaded — including the declaration files pulled in transitively and the
ones shipped with TypeScript — every tsconfig the program was built from, the
TypeScript version, the checker plugin version, and the checker's own options. A
change to any of them, or a verdict recorded without that key, re-checks the
mutant.

Hashing the program needs the checker running, so a run that has one re-checks
the mutants it must either way; only the per-mutant check is saved. The
incremental report writes the program digest beside every `CompileError` verdict
it records, and the reuse stream line counts a refusal to reuse one under the new
`programChanged` reason, next to the existing refusal reasons.
