---
"@systemfsoftware/stryker-js": minor
---

A new `stryker plan` subcommand discovers each project's mutants without running tests, decides reuse against that project's incremental report, costs every scheduled mutant, and packs them into deterministically LPT-scheduled shards. It takes `--target-seconds`, optional `--max-shards`, `--projects`, `--out`, and `--full`, writes a `ShardPlan`, and emits a `plan` stream event.
