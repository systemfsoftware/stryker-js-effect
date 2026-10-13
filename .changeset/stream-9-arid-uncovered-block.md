---
"@systemfsoftware/stryker-js-cli-contract": minor
---

The run stream moves to schema version `9.0`. An Ignored mutant's `statusReason` may now carry the rule id `arid-uncovered-block`, which names the `NoCoverage` mutant of the block whose condition the ignored mutant sits in. `StreamSchemaVersion` and the published stream schema enumerate `9.0` in place of `8.0`, and a consumer pinned to `8.0` must accept `9.0`: the `8.0` codec refuses an `Ignored` line whose reason starts `arid-uncovered-block:`.
</content>
