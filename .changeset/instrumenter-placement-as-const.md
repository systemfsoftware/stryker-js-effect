---
"@systemfsoftware/stryker-js-instrumenter": patch
---

Mutating a negated property check such as `if (!obj.prop)` no longer aborts the run with a placement error. Mutations inside `as const` expressions are generated again; previously every literal inside an `as const` object or array was silently skipped, which inflated the reported mutation score.
