---
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
---

`mutant` lines and `mutant-detail` events carry what an agent needs to act. `statusReason` is always `<code>: <detail>` (`Mutant.StatusReason`; reused verdicts read `remembered: <detail>`). Killed adds `killedBy`; Survived, Timeout and RuntimeError add `original`, `coveredBy` and `next`; NoCoverage adds `original` and `next`. `original` is `null` when the file could not be read. The clear-text `Error message:` line prints the detail without its code.

Breaking:

- A line missing its status's fields or reason code is refused; build one with `RunEvent.RunMutantTestedEvent.cases.<Status>.make(...)`.
- On `mutant-detail`, read `event.mutant.id`, `.status` and `.coveredBy` (Survived, Timeout, RuntimeError) for `event.id`, `event.status` and `event.coveringTests`.
- Incomplete facts fail the run with `mutant-facts-invalid` (`Mutant.RunFailureCode`).
