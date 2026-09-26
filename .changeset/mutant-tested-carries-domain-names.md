---
"@systemfsoftware/stryker-js-plugin-interface": major
---

`Reporter.MutantTested` names the tested mutant's fields after the mutant itself: `file` is now `fileName` and `mutator` is now `mutatorName`. `id`, `status`, `location`, `replacement`, `completed` and `total` keep their roles, and the mutation stream's emitted lines are unchanged.

Replace `mutant.file` with `mutant.fileName` and `mutant.mutator` with `mutant.mutatorName` where you build or read a `MutantTested`.
