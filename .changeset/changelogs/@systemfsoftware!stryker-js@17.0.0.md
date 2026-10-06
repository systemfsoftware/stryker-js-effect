## 17.0.0

### Major Changes

- A mutant's timeout now starts when its first test begins, not when the test runner is asked to run it. With a short `timeoutMS`, a mutant its tests would kill is reported `Killed` instead of `Timeout`, so a slow or busy machine no longer changes the verdict. A mutant whose tests never begin still ends, on the same window that bounds a plugin worker which never accepts its connection.

  If you author a test-runner plugin, `mutantRun` now streams its run: emit `MutantRunStarted` before the runner's first test begins, then `MutantRunSettled` carrying the result.

### Patch Changes

- A merged shard report now records the run budget, so a budget check can read it and `--update-budget-baseline` can bootstrap a baseline from it. Before, every merged report was refused with `the finished mutation report records no budget`. The budget's actual time is the slowest shard: the sum of its projects' run times, because shards run side by side. The predicted time is the plan's largest per-shard prediction. If any project's progress stream holds no verdict, the merged report carries no budget.
