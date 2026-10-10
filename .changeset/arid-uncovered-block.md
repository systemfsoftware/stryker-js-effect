---
"@systemfsoftware/stryker-js": minor
---

Under `coverageAnalysis: 'perTest'`, a mutant in the condition of an `if` no longer runs when no test executes the `if`'s block and at least one mutant of that block ends `NoCoverage` in the same run. It is Ignored with a status reason starting `arid-uncovered-block:`, which names the block's `NoCoverage` mutant. The block's own mutants keep their `NoCoverage` status, so the missing test still shows in the score. If the `if` has an `else` block that a test executes, the condition mutants run: that test executes the condition. If every mutant of the block fails to compile or is ignored, the condition mutants run as before.

An incremental run never reuses an `arid-uncovered-block` result; it decides it again from the current run. A shard plan keeps each condition mutant in the same shard as its block. Set `mutator: { mutantSetPolicy: 'full' }` to run every condition mutant.
