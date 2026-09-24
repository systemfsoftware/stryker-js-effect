---
"@systemfsoftware/stryker-js-instrumenter": patch
---

Every mutant now reports its position as 1-based coordinates — the base the
mutation-testing report schema uses, where the first line of a file and the
first character of a line both sit at the first position.

A mutant in a plain TypeScript or JavaScript file previously reported a line one
below its real position, so pointing a reader at the reported coordinates
highlighted the wrong line.
