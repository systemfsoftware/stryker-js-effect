---
"@systemfsoftware/stryker-test-contribution": major
---

The package entry point now exports only `strykerPlugins`, the list the engine loads the test-contribution evaluator from.

- Remove imports of `judgeTestContribution`, its decision types, `makeTestContributionEvaluatorService`, `testContributionEvaluatorLayer` and the helpers removed alongside them. They have no public replacement.
