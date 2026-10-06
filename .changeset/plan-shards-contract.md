---
"@systemfsoftware/stryker-js-cli-contract": minor
---

`ShardPlan` is a new published contract: a deterministic shard plan carrying each shard's project mutant lists, predicted seconds, and a GitHub Actions matrix. The `plan` stream event now carries a required `shardPlan` field, and the stream schema version moves to `5.0`.
