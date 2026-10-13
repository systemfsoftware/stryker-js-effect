---
"@systemfsoftware/stryker-js-cli-contract": minor
---

The run stream moves to schema version `9.0`. An Ignored mutant's `statusReason` may now carry the rule id `constant-collection-size`, which names a comparison of an array, tuple or string length with zero that the TypeScript checker proves always true or always false (`xs.length >= 0`) when a kept mutant at the same site already replaces the comparison with that constant. `StreamSchemaVersion` and the published stream schema enumerate `9.0` in place of `8.0`, and a consumer pinned to `8.0` must accept `9.0`: the `8.0` codec refuses an `Ignored` line whose reason starts `constant-collection-size:`.
