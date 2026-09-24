---
"@systemfsoftware/stryker-test-contribution": major
---

`judgeTestContribution` now takes a `JudgeTestContribution` command and returns a `TestContributionDecision`.

- Match on the decision variants, such as `RunReviewed`, `RunUnjudged` and `JointlyDeletable`, instead of the removed `TestContributionVerdict`.
- Remove imports of `contributionByTestFile`, `toothlessTestFiles`, `defaultRequireTestContributionSuffixes` and `TestContributionInput`. They have no public replacement.
