---
"@systemfsoftware/stryker-js": minor
---

A subsumed mutant (the Ignored complement of a kept ordering mutant, e.g. `a >= b` beside `a <= b`) now runs again whenever none of the dominators named in its `Subsumed` reference runs: a dominator the checker ignores, a dominator that fails to compile, a dominator ignored at plan time, or a remembered dominator that did not run. It is then checked and executed like any other mutant, and its `subsumption` becomes a `Readmitted` reference naming each dominator and why it did not run. While a named dominator does run, the mutant stays Ignored and its status reason names the dominator. A mutant already Ignored for another reason (for example `ignoreStatic`) keeps that reason.

A shard plan keeps each subsumed mutant in the same shard as its first dominator, without raising the shard count above `maxShards`.
