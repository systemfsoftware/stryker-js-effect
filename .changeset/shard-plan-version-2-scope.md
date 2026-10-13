---
"@systemfsoftware/stryker-js-cli-contract": minor
---

`ShardPlan` is version 2 and carries a required `scope`: `Unscoped`, `DiffScoped` with `base`, `head` and `worktree`, or `FullScope` with `base`, `head`, `worktree` and `reason`. A scoped plan's `worktree` is a SHA-256 digest of every path its checkout reports as modified, added or untracked, paired with the content the working tree holds at that path, and the empty string for a clean tree. Version 1 plans no longer decode, and the `PlanKnown` stream event carries the new shape, so `StreamSchemaVersion` moves to `9.0`.
