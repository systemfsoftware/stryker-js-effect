---
"@systemfsoftware/stryker-js": major
---

`Checker.checkGroupedPlans` is replaced by `Checker.checkGroupedCell`. Call `Checker.checkGroupedCell.run({ checker, checkerName, plans })` where you called `Checker.checkGroupedPlans(checker, checkerName, plans)`. It groups the plans with the checker, checks each group, and returns the same results and errors as before.
