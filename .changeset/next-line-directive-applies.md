---
"@systemfsoftware/stryker-js-instrumenter": patch
---

Disable comments with the `next-line` scope now ignore the mutants on the line directly below the comment and record the given reason. Before this fix they ignored nothing.
