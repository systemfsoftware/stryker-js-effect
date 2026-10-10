---
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js": major
---

Each `mutant` line and `mutant-detail` event now carries, by status, what an agent needs to act: `killedBy` on Killed; `original`, `coveredBy` and a `next` action (`RunEvent.NextAction`) on Survived, NoCoverage, Timeout and RuntimeError. `statusReason` is always `<code>: <detail>` with a code from `Mutant.StatusReason`.

Breaking:

- Build a line with `RunEvent.RunMutantTestedEvent.cases.<Status>.make(...)`; a line with a missing or foreign reason code, or missing its status's fields, is refused.
- Read `event.mutant.id`, `event.mutant.status` and `event.mutant.coveredBy` on `mutant-detail` where you read `event.id`, `event.status` and `event.coveringTests`.
