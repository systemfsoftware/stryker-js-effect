---
"@systemfsoftware/stryker-js-engine": major
---

Removed `runMutationTest`. Start a run with `mutationTestCell` and pass the CLI options plus target mutate patterns as its command.

To migrate, replace `runMutationTest(cliOptions, targetMutatePatterns)` with `mutationTestCell.run({ cliOptions, targetMutatePatterns })`.
