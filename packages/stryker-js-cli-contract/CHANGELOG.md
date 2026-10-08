# @systemfsoftware/stryker-js-cli-contract

## 0.4.0

An incremental run now reuses `CompileError` verdicts instead of type-checking
every one again. A verdict is kept only while nothing that fed the check
changed: the mutant and its replacement, every file the checker's TypeScript
program loaded (including transitive and bundled declaration files), every
tsconfig in the `extends` chain and its project references, the TypeScript
version, the checker version and its options. Otherwise the mutant is
re-checked. The reuse stream line reports such refusals as `programChanged`
(or `closureAnalysisFailed` when the closure analysis failed); lines without a
count still decode.

Breaking: a configured checker must answer the new `digest` RPC, so upgrade
checker plugins together with this release. A `plan` stream line can now carry a `projects` array naming, for every planned project, how many mutants were reused, how many will run, the refused count per reason, and the reason a whole incremental report was discarded. The machine stream version is unchanged: a stream line without `projects` still decodes, and consumers that read reuse numbers from a plan can now see why a plan scheduled work it expected to reuse. The published package now includes its changelog. Enable the `@effect/language-service` tsgo plugin in every source package's `tsconfig.app.json` and `tsconfig.test.json`, and bump `@effect/tsgo` to `^0.50.0`. This turns on Effect-aware diagnostics during `effect-tsgo` type checking; it changes no runtime behaviour or public API.

## 0.3.1

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@14.0.0

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

## 0.2.0

### Minor Changes

- Effect moves to the stable `4.0.0` release, together with the `@effect/*` packages these libraries use. The `4.0.0` release candidates are no longer supported: install `effect` `^4.0.0` next to these packages before upgrading.

  The TypeScript checker and test-runner plugins bundle their own Effect runtime, so they need no change in your project.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@12.0.0

## 0.1.0

### Minor Changes

- Naming mutant ids on the run command re-runs exactly those mutants, restricting the mutated files to their ids' files with verdict reuse left on and reporting each selected mutant's status, covering tests, killing test, and reproducer command, while the trace names the new rerun span for that path.
