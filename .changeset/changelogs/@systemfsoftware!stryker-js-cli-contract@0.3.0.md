## 0.3.0

### Minor Changes

- Mutation testing is now incremental by default: `incremental` defaults to `true`, so an unchanged mutant whose covering tests are unchanged is re-used instead of re-run. `--full` (aliasing the old `--force`) re-verifies every mutant, ignoring the cache and the persisted dry run. The `verdict` stream event records `incrementalMode` (`incremental` or `full`). A run with no reusable cache falls back to a full run as before.

- The machine run-event contract (stream version 6.0) adds a required `budget` object, predicted and actual seconds, to every `verdict` line, so a consumer can observe how much of a run's time budget a change consumed.

- `ShardPlan` is a new published contract: a deterministic shard plan carrying each shard's project mutant lists, predicted seconds, and a GitHub Actions matrix. The `plan` stream event now carries a required `shardPlan` field, and the stream schema version moves to `6.0`.

- A mutation run now starts only on main CI. The `run` command, the programmatic run entry point, and every other surface that begins a mutation run refuse to start unless the process runs under GitHub Actions (`GITHUB_ACTIONS=true`); anything else — a developer machine, a fork, or another CI — exits non-zero instead of running mutants. A refused run ends the machine-readable output with a new `refused` event whose `rule` is `mutation-runs-on-main-ci`, and the machine-stream schema version is now `3.0`. Dry runs (`--dryRunOnly`), `--version`, and config and help commands are unaffected.

- The contract package now exports the shard plan schema: the versioned document a planner emits and a sharded run consumes, describing each shard's projects and the mutant ids it must run. A plan is refused when two shards share a label, because `--shard k/N` could not tell them apart.

- The machine stream declares version `6.0` and carries a new `worker` line, `{ _tag: "worker", schemaVersion, role, index, startupMs }`, emitted once per test-runner or checker process boot. A consumer that switches exhaustively over the stream's event tags must handle the new tag; the start-up cost of a reused worker is now visible instead of being folded into the first mutant's cost.

- The TypeScript checker now applies Trivial Compiler Equivalence (Papadakis et al., ICSE 2015). Each mutant of a file is emitted to JavaScript from the project's own TypeScript configuration in transpile-only mode, normalized, and compared with the original file's emit and with the mutants already emitted at the same site. A mutant whose emit equals the original's is dropped as `Ignored` with reason `equivalent-to-original: tce`; one that equals an earlier same-site mutant's is dropped with `duplicate-at-site: tce`; every mutant whose emit differs is kept, so the check never removes a mutant that changes the program. Checkers gain an `ignored` result variant carrying the suppression reason, and a run publishes the new `tce` machine-stream event with the `equivalentToOriginal` and `duplicateAtSite` counts. Verdict semantics move to version 3.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@13.0.0
