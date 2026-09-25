---
'@systemfsoftware/stryker-js-plugin-interface': major
---

`Report.Metrics#mutationScore` and `Report.Metrics#mutationScoreBasedOnCoveredCode` now return a `Report.MutationScore` instead of a number: `Scored` with a `percentage` between 0 and 100, or `Unscored` when no tested mutant counts toward the score. Previously an empty run produced `NaN`. Read the value with `Report.MutationScore.match(score, { Scored: ({ percentage }) => …, Unscored: () => … })`.
