---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-cli-contract": patch
---

The verdict on the mutation score now runs inside its own span, `stryker.mutationReporting.judgeScore`, which the span taxonomy declares. The verdict's log lines are recorded as events under that span instead of directly on `stryker.mutationReporting.reportAll`. Exit codes and log text are as before: a score below `thresholds.break` exits 1, a score equal to it passes, and a reporter that fails on the final report still exits 3 when the score is also below the threshold.
