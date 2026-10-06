---
"@systemfsoftware/stryker-js": patch
---

A merged shard report now records the run budget, so a budget check can read it and `--update-budget-baseline` can bootstrap a baseline from it. Before, every merged report was refused with `the finished mutation report records no budget`. The budget's actual time is the slowest shard: the sum of its projects' run times, because shards run side by side. The predicted time is the plan's largest per-shard prediction. If any project's progress stream holds no verdict, the merged report carries no budget.
