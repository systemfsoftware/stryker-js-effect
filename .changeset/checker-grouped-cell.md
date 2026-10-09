---
"@systemfsoftware/stryker-js": major
---

`Checker.checkGroupedPlans` is gone. Use `Checker.checkGroupedCell`, the cell it wrapped: `checkGroupedCell.run({ checker, checkerName, plans })` groups the plans with the checker and then checks each group, with the same result and errors as before.
