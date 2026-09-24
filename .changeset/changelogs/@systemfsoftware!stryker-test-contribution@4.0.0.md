## 4.0.0

### Major Changes

- The package entry point now exports only `strykerPlugins`, the list the engine loads the test-contribution evaluator from.

  - Remove imports of `judgeTestContribution`, its decision types, `makeTestContributionEvaluatorService`, `testContributionEvaluatorLayer` and the helpers removed alongside them. They have no public replacement.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@8.0.0
