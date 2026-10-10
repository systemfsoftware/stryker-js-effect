---
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js": major
---

**Breaking:** the run stream moves to schema version `8.0`. Every `mutant` line has a required `subsumption` key: `null`, a `Subsumed` reference (rule and dominator ids) on an Ignored line, or a `Readmitted` reference (rule, each dominator and its cause code) on a line that is not Ignored. A line that lacks the key or whose reference disagrees with its status is refused. `stryker merge` refuses a `7.0` shard stream and keeps `subsumption` in the merged report. Read the key, or set `mutator: { mutantSetPolicy: 'full' }` to get only `null`.

The incremental report keeps the reference on each record, and a record carrying one is never remembered: it counts under the new reuse refusal `decidedPerRun`.

Subsumed mutants are Ignored, so the mutation score covers only the kept mutants and differs from a `full`-policy run.
