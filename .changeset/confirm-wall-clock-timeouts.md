---
"@systemfsoftware/stryker-js": major
---

A wall-clock expiry no longer scores a mutant as a detected Timeout on its own. When a mutant's run outlasts its deadline, the worker is replaced as before and the mutant runs once more in the same run, on the fresh worker, under twice the deadline. It is reported Timeout (`wall-clock-timeout`) only if that run expires too; otherwise it gets the verdict its tests give, and the score counts it that way. A hit-limit Timeout is unchanged.

Breaking: mutants that a slow run used to push over the deadline now report Survived or Killed, so mutation scores can drop. A confirmed Timeout is reused by the next incremental run instead of being refused as `timeoutUnreproduced`, and its recorded cost covers both attempts.
