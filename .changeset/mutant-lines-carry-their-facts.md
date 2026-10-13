---
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
---

`mutant` lines and `mutant-detail` events carry what an agent needs to act. `statusReason` is `<code>: <detail>` there and in the JSON report (`Mutant.StatusReason`; reuse reads `remembered: <detail>`). Killed adds `killedBy`; Survived, Timeout and RuntimeError add `original`, `coveredBy` and `next`; NoCoverage adds `original` and `next`. `original` is `null` for an unreadable file. Clear-text prints the detail.

Breaking:

- The stream version moves from 8.0 to 9.0.
- A line missing its status's fields or reason code is refused; build one with `RunEvent.RunMutantTestedEvent.cases.<Status>.make(...)`.
- On `mutant-detail`, read `event.mutant.id`, `.status` and `.coveredBy` (Survived, Timeout, RuntimeError) for `event.id`, `event.status` and `event.coveringTests`.
- Report readers wanting the bare failure or error strip the code; incomplete facts fail the run (`mutant-facts-invalid`).
