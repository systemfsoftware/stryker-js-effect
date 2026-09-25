---
'@systemfsoftware/stryker-js-plugin-interface': major
---

`Report.Metrics#mutationScore` and `Report.Metrics#mutationScoreBasedOnCoveredCode` now return a `Report.MutationScore` instead of a number: `Scored` with a `percentage` between 0 and 100, or `Unscored` when no tested mutant counts toward the score. Previously an empty run produced `NaN`, which compared false against every threshold.

Code that read the score as a number must match on it:

```ts
// before
const failing = metrics.mutationScore < 80

// after
const failing = Report.MutationScore.match(metrics.mutationScore, {
  Scored: ({ percentage }) => percentage < 80,
  Unscored: () => false,
})
```
