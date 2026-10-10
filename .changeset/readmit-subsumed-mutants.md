---
"@systemfsoftware/stryker-js": minor
---

A subsumed mutant (the Ignored complement of a kept ordering mutant, e.g. `a >= b` beside `a <= b`) now runs again whenever none of the dominators named in its `redundancy` reference runs: a dominator the checker ignores, a dominator that fails to compile, or a remembered dominator that did not run. It is then checked and executed like any other mutant, and its result carries an optional `readmission` reference naming each dominator and why it did not run. While a named dominator does run, the mutant stays Ignored and its status reason names the dominator that ran.

A shard plan keeps each subsumed mutant in the same shard as its first dominator, without raising the shard count above `maxShards`.
