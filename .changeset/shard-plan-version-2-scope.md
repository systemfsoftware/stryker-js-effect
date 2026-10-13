---
"@systemfsoftware/stryker-js-cli-contract": minor
---

`ShardPlan` is version 2 and carries a required `scope`: `Unscoped`, `DiffScoped` with `base`, `head`, `sources` and `files`, or `FullScope` with those and `reason`. A scoped plan's `files` lists the repository-relative paths it schedules mutants in, and `sources` is a SHA-256 digest of each of those paths paired with the git blob digest of the content the working tree holds there, the empty digest for a path the tree no longer holds. Version 1 plans no longer decode, and the `PlanKnown` stream event carries the new shape, so `StreamSchemaVersion` moves to `9.0`.
