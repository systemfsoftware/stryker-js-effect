---
'@systemfsoftware/stryker-js': minor
---

`stryker gate` judges and prints every verdict: new survivors against `--baseline`, the budget against `--budget-baseline`, and each project's `thresholds.break`. When several verdicts fail, it prints each one once and exits 1 on the first in this order: the break, then new survivors, then the budget. Before, the gate stopped at the first failing verdict, so a new survivor or a budget breach hid a break. Unusable input (exit 2) still stops the gate at once.
