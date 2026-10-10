---
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js": minor
---

**Breaking:** the run stream moves to schema version `7.0`. Every `mutant` line now has required `redundancy` and `readmission` keys. Each is `null`, or the subsumption reference: the rule plus the dominator ids, and for a re-admission each dominator's cause code. A reader pinned to `6.0` refuses the stream; read the two keys, or set `mutator: { mutantSetPolicy: 'full' }` to get only `null`.

The incremental report keeps the same two references on each mutant record. A record carrying one is never remembered on the next run; the run counts it under the new reuse refusal `decidedPerRun`, because whether a subsumed mutant runs depends on its dominators' outcomes in that run.
