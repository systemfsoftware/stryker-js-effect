---
"@systemfsoftware/stryker-js-cli-contract": major
---

The run stream moves to schema version 10.0: the embedded ShardPlan version 2 scope makes version 9.0 readers reject plans that the stream now carries. Readers that pin schemaVersion 9.0 must move to 10.0.
