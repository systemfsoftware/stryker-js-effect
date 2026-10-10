---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-plugin-interface": minor
---

Whether a mutant result was reused is now `RunMutantResult.remembered`. The incremental record no longer has a `remembered` field, because reused verdicts come from the verdict store. A reused Ignored verdict still names its ignore rule. An Ignored verdict whose reason names no ignore rule is not stored, so the next run decides it again.

Breaking: read `remembered` from the mutant result instead of from the incremental record.
