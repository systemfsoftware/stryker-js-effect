---
title: Cell Layer Placement - Plan
type: refactor
date: 2026-10-11
topic: cell-layer-placement
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Cell Layer Placement - Plan

## Goal Capsule

- **Objective:** every Layer and Layer-producing export in `packages/**` and `test/e2e` sits where the cell-architecture service and layer rule puts it. `./bin/gritlint check` enforces that rule in this repository, and `.compound-engineering/config.yaml` pins the systemfsoftware packs to a commit instead of following `tree/main`.
- **Means:** two stacked pull requests (KTD1). PR A makes the tree pass the gate as written and turns the gate on: the six refused files are fixed, `gritlint.json` enrols `cell-architecture`, the gritlint flake input is re-locked to gritlint main, and the packs are pinned. PR B finishes the placement the gate cannot see: handle-backed implementations, `layerConfig` names, the `src/drivers/` folders, the instrumenter parser module and the e2e harness.
- **Product authority:** the stream supervisor. The rule is settled: `compound-packs/cell-architecture/service-and-layer-boundaries.md` as merged in systemfsoftware#708 (`f2bfe45df4`), the gate turned on in systemfsoftware#728, R1-R14 of systemfsoftware `docs/plans/2026-10-10-1748-refactor-cell-service-layer-structure-plan.md`, and this repository's `docs/adr/0003-driver-implementations-sit-beside-their-service.md`.
- **Authority order:** `CONSTITUTION.md` > `AGENTS.md` > this plan.
- **Stop conditions:** stop and report if the gate refuses a placement this plan calls compliant, if gritlint exits 2 or reports an unparseable module after the re-lock, if a move changes a test's verdict, or if Changeset Check asks for a bump this plan does not list.

## Product Contract

### Summary

Six `*.service.ts` modules fail the rule as the gate reads it: they export `*Live` aliases, export module-level Layers, or have class fields named `*Layer`. Seven more Layers fail it on what their code does, which the gate cannot see. They read `Config` under the name `layer`, are named `stage`, build their implementation on a driver-backed handle or blueprint, or import a sandbox driver from a service module. Three driver modules still live under `src/drivers/`. This work moves each one to the place the rule prescribes, removes the aliases, and then turns the gate on so the placement stays.

### Problem Frame

ADR-0003 (accepted 2026-10-10) settled the placement, but only review enforced it. The gritlint rule that systemfsoftware#728 turned on (`cell-architecture/service-exports-no-layer`) is not enrolled in this repository's `gritlint.json`. The locked gritlint, `1d60be3` (`flake.lock`, `nodes.gritlint.locked.rev`), predates `fe886c5`, the merge of gritlint#10, which the rule needs to parse `dual` overload type literals. `.compound-engineering/config.yaml:2-4` names three packs by `tree/main` URL, so pack text can change under the repository without any commit here.

### Requirements

Placement:

- R1. No `*.service.ts` exports a module-level Layer, a `*Live` binding or a Layer alias, and no class field in one is named `*Layer`, `*Live` or `Default`. Source: sfs plan R4, R12 and R14.
- R2. No `*.service.ts` imports a driver, statically or through `import()`. Driver means a vendor SDK or concrete runtime: `node:*`, `@effect/platform-<runtime>`, `vitest`, `oxc-parser`, `typescript` (runtime), `@opentelemetry/*`, `@systemfsoftware/effect-microsandbox` and `@systemfsoftware/vitest-config/telemetry`. A type-only import is allowed, as the gate allows it. Source: sfs plan R2.
- R3. An implementation that needs only Effect and abstract tags is a `static readonly layer` (or `layerConfig`, `layerTest`, `layerNoop`, `layer<Variant>`) on its Service class. Source: sfs plan R3 and R4, ADR-0003:38.
- R4. An implementation that imports a driver, or builds on a handle or blueprint that does, lives in a flat module beside its service. That module exports module-level `make` and `layer`, and composition roots and tests are its only importers. Source: sfs plan R5 and R6, ADR-0003:35-37.
- R5. A Layer member that reads its options through `Config` is named `layerConfig`. Source: sfs plan R4, pack `service-and-layer-boundaries.md` (tier 2 names).
- R6. No `src/drivers/` folder remains in any package. Source: sfs plan R6, ADR-0003:37.
- R7. Each move preserves behaviour. Existing tests prove it, and no test is bent to fit.

Gate and packs:

- R8. `gritlint.json` enrols `cell-architecture`, and the gritlint flake input is locked to gritlint main at or after `fe886c5`. One input changes, through a normal lock update.
- R9. `pnpm lint:conventions` exits 0 with zero findings and no unparseable module. A planted `*.service.ts` violation exits 1 with rule id `cell-architecture/service-exports-no-layer` and exits 0 once removed.
- R10. `.compound-engineering/config.yaml` pins the three packs it already declares (cell-architecture, boundary-testing, schema-laws) to systemfsoftware commit `02bf9653b1ca2b0a2951baf2743bb3f70d19fc77`, using the `source`/`ref`/`path`/`pack` form.

Delivery:

- R11. At most two PRs. Each passes CI on its own and ships working behaviour on its own.
- R12. Each PR body carries a table with the columns Layer, tier, file, and why (pure, or which driver), and a "How an agent consumes this" section covering every new or changed surface: gate finding, CLI output and report field.
- R13. Every removed or renamed public export is listed with its `etc/*.api.md` entry, or with the fact that it has none, and gets a changeset at the matching bump.

### Acceptance Examples

- AE1. `git grep -nE 'OutputModeProbeLive|RunEventDrainLive|WorkerReportsLive|captureLayer|fileLayer|RunEnvironment\.stage\b' -- packages test ':!**/CHANGELOG.md'` returns nothing (exit 1).
- AE2. `git ls-files 'packages/**/src/drivers/**'` prints nothing.
- AE3. After PR A: a scratch `packages/stryker-js/src/planted.service.ts` containing `import { readFile } from 'node:fs/promises'` makes `./bin/gritlint check --format json` exit 1 with one finding whose `ruleId` is `cell-architecture/service-exports-no-layer`. After `rm`, the same command exits 0.
- AE4. `CheckerRuntime.service.ts`, `VitestSession.service.ts`, `guest-job.service.ts`, `fixture-cache.service.ts` and `stryker-cli-runner.service.ts` hold no `Layer.effect`/`Layer.succeed` call. Each implementation sits in the sibling module the inventory names.

### Scope Boundaries

In scope: `packages/**`, `test/e2e` (harness source), `gritlint.json`, `flake.lock` (the gritlint input only), `.compound-engineering/config.yaml`, changesets and api reports.

Out of scope:

- The capability-package split and any new package (old L2), plus `package-topology`.
- `packages/stryker-js/src/mutation-reporting.service.ts` beyond what its own Layer needs (Stream D owns it). Its `static readonly layer` (`:160`) is pure and stays.
- New suffixes or folders, and renaming files that already comply. For example, the `*.service.ts` modules with no Service class but no driver and no Layer (`Instrument.service.ts`, `Mutator.service.ts`, `Transformer.service.ts`, `PluginRpcs.service.ts` and others) keep their names here.
- gritlint ignore entries, overrides, or disables. No PR or push to gritlint or systemfsoftware. A misfire or miss becomes a follow-up in "Gate Follow-ups".
- Local or per-PR mutation runs. Workflow changes: none are needed.

## Planning Contract

### Key Technical Decisions

- KTD1. **Two PRs, stacked (OP13b), gate first.** PR A (U1-U5) fixes the six files the gate refuses (G1-G3), renames `RunEnvironment.stage` so stryker-js ships one major, and turns the gate on with the lock and pack pin. PR B (U6-U10) moves everything the gate cannot see. Its base is PR A, and it touches `vitest-runner/src/main.ts` and `vitest-test-runner.ts` after PR A. There are three reasons for this order. The gate starts guarding the tree before the larger PR B moves land. Every decision deferred to the supervisor (Q1, Q2) falls in PR B, so a ruling there cannot reopen PR A. And G3 proves the PR A fixes are sufficient for the gate. A single PR would also pass CI. It is not chosen, because a gritlint lock regression would then revert with code moves, and the open questions would block the gate.
- KTD2. **Classification reads the code, not only the gate's flags.** The gate refuses six files (G1, G2). Seven more Layers violate R2-R5 in ways the gate cannot see: two `*.service.ts` modules import a driver the preset does not list, a module-level Layer built by a vendor `.layer(...)` call passes R12, R13 leaves reach through a handle to the package graph, and the gate does not check member names other than `*Layer`/`*Live`. Each of these is moved or renamed here, and each gate miss is recorded as a follow-up.
- KTD3. **Handle-backed and blueprint-backed implementations are driver-backed (R4).** `CheckerRuntime.layer` provides `TypeScriptCompiler` from `ts-compiler.blueprint.ts` and calls `ts-compiler.handle.ts`, both of which import `typescript` at runtime. `VitestSession.layer` builds the runtime through `VitestRuntime.handle.ts` and `VitestRuntime.blueprint.ts` (`vitest/node`). `BakedFixtureCache.layer` and `StrykerCliRunner.layer` call `warm-sandbox.handle.ts` (`@systemfsoftware/effect-microsandbox`). None of these needs only Effect and abstract tags (R3), so each implementation moves to a sibling module. Each service module keeps its class, its Shape, and type-only imports.
- KTD4. **Tier-3 module names.** Each new sibling exports `make` and `layer`. Filenames follow the repository's precedent `<technology>-<capability>.ts` (`oxc-source-parser.ts`, ADR-0003:41): `typescript-checker-runtime.ts`, `vitest-session.ts`, `vitest-test-runner.ts`, `guest-job.ts`, `fixture-cache.ts`, `stryker-cli-runner.ts`. A module that only leaves `drivers/` keeps its basename. `trace-context-rpc.service.ts` becomes `trace-context-rpc.ts` and keeps its public export names `layerTraceContextClient`/`layerTraceContextServer`, which are `layer<Variant>` names (R4), not `*Live`/`Default`.
- KTD5. **Composition roots bind adapter to adapter.** `vitest-test-runner.ts`'s `layer` requires `VitestSession` and stops providing it. The root `packages/stryker-js-vitest-runner/src/main.ts` provides `vitest-session.ts`'s `layer`. The same holds in `test/e2e/src/Harness/harness-layers.ts`, the harness root (imported only by `test/e2e/tests/__fixtures__/e2e-harness.fixture.ts:18` and `global-setup.ts:6`). Its tier-1 `HarnessServicesLive`/`HarnessPlatformLive` stay: a composition root may hold tier 1 (pack tier table, row 1).
- KTD6. **Bumps (BREAK-1).** `@systemfsoftware/stryker-js` major (19.0.0), `@systemfsoftware/stryker-js-plugin-runtime` major (7.0.4), `@systemfsoftware/stryker-js-typescript-checker` major (8.3.2). `@systemfsoftware/stryker-js-vitest-runner` and `@systemfsoftware/stryker-js-instrumenter` get `none`, because every change is internal to `src/` and neither package's exports map or api report changes. `test/e2e` (`@systemfsoftware/stryker-e2e`, private) gets an intent only if Changeset Check asks for one.
- KTD7. **No new permanent test.** Each unit is a move or rename. Its proof is `tsc -b` (every call site resolves), the existing tests named per unit, `api:check`, and the gate. The `test-layer-selection` admission gate admits nothing new. Moved service and adapter modules keep their existing integration coverage, and composition roots are exempt (smoke boot only). The planted probe is a throwaway gate check, not a test. Mutation globs select only `*.workflow.ts` and `*.schema.ts`, so no mutant id moves. The one type that moves into a `*.schema.ts` (`RunFilter`, U3) is a type, so it adds no mutant.

### Evidence

All evidence is taken at `origin/main` `6c6eaaa991`.

- G1. **Gate probe** (P4): `cell-architecture: {}` added to a scratch, uncommitted copy of `gritlint.json`; binary gritlint main `5c9c2ab` (`/nix/store/84r8vvyik6w4a2h5fnz9nj14cc68vvbc-gritlint-0.1.0`). Exit 1, stderr empty, no unparseable module, `filesSelected: 1211`, `findings: 4`, `zeroFileRules: ['source-resolution/tsconfig-preset-module-mode']`:
  - `packages/stryker-js-plugin-runtime/src/trace-context-rpc.service.ts` 130:40-130:101, `service-exports-layer`
  - `packages/stryker-js-vitest-runner/src/VitestRunner.service.ts` 197:3-197:57, `service-exports-layer`
  - `packages/stryker-js/src/output-mode-probe.service.ts` 130:1-130:57, `service-exports-layer`
  - `packages/stryker-js/src/reporting/machine-console.service.ts` 205:3-211:4, `service-exports-layer`
- G2. **One finding per directory hides the rest.** Deleting each flagged file in the scratch copy and re-running surfaced `packages/stryker-js/src/run-event-stream.service.ts` 128-138 (round 2) and `packages/stryker-js/src/run-events.service.ts` 31-55 (round 3). Round 4 exited 0.
- G3. **Gate-sufficient fix probe:** in a scratch copy, delete both `*Live` aliases, rename `captureLayer`→`layerCapture` and `fileLayer`→`layerFile`, un-export `WorkerReportsLive`, and rename the two flagged non-service modules. Result: exit 0, `findings: 0`, 1211 files.
- G4. **Lock state:** `flake.lock` gritlint `rev` is `1d60be38284be2c9a8af73f67334d43a841c9fd7` (gritlint#4). `git merge-base --is-ancestor fe886c5 1d60be3` fails. gritlint main is `5c9c2ab21010d86533898febca91680b6756db06` (#13), which descends from `fe886c5`.
- G5. **Pack pin form:** `systemfsoftware/github-selfhosted-runner` `.compound-engineering/config.yaml` uses `source: https://github.com/systemfsoftware/systemfsoftware`, `ref: <sha>`, `path: compound-packs`, `pack: [cell-architecture, boundary-testing, schema-laws, package-topology]`. The CE resolver accepts `ref`, `path` and `pack` (`skills/ce-brainstorm/scripts/packs-resolve.py:36-41`). systemfsoftware main `02bf9653b1` contains `f2bfe45df4` (#708) and `ee27f80c2d` (#728).

### Layer Inventory

Every Layer or Layer-producing export in `packages/**/src` and `test/e2e/src`, excluding in-source test blocks. The "Gate" column reports what G1/G2 show. Tiers: 1 = composition root, 2 = pure static on the Service class, 3 = driver-backed sibling module, cell = a cell kind (`*.cell.ts`, `*.blueprint.ts`, `*.handle.ts`) outside this rule's placement.

| #  | Export (file:line)                                                                                                                                                                     | Today                                                               | Gate                         | Classification (why)                                                                                                               | Target                                                                                                                                  | Unit   |
| -- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1  | `layerTraceContextClient` `plugin-runtime/src/trace-context-rpc.service.ts:108`                                                                                                        | module-level in `*.service.ts`                                      | - (same dir as 2)            | tier 3: imports `@opentelemetry/api`; the file has no Service class (its tag is `plugin-interface/src/TraceContextRpc.service.ts`) | file → `trace-context-rpc.ts`, names kept                                                                                               | U2     |
| 2  | `layerTraceContextServer` same file `:130`                                                                                                                                             | module-level                                                        | refused 130:40               | tier 3, as row 1                                                                                                                   | as row 1                                                                                                                                | U2     |
| 3  | `WorkerOptions.layer` `plugin-runtime/src/worker-options.service.ts:16`                                                                                                                | static                                                              | clean                        | tier 2, pure, but reads `Config.String('STRYKER_WORKER_DIR')`                                                                      | rename → `layerConfig` (R5)                                                                                                             | U6     |
| 4  | `WorkerTelemetry.layer` `plugin-runtime/src/worker-telemetry.service.ts:19`                                                                                                            | static                                                              | clean                        | tier 2, pure, reads `workerTelemetryConfig`                                                                                        | rename → `layerConfig` (R5)                                                                                                             | U6     |
| 5  | `CheckerRuntime.layer` `typescript-checker/src/CheckerRuntime.service.ts:107`                                                                                                          | static                                                              | clean                        | tier 3 (KTD3): provides the `ts-compiler.blueprint.ts` layer, calls `ts-compiler.handle.ts` (`typescript`)                         | `make` + `layer` → `typescript-checker-runtime.ts`                                                                                      | U7     |
| 6  | `layer` `vitest-runner/src/VitestRunner.service.ts:194`                                                                                                                                | module-level, no Service class                                      | refused 197:3                | tier 3: implements plugin-interface `TestRunner` over vitest                                                                       | file → `vitest-test-runner.ts` (U3); stops providing `VitestSession` (U8)                                                               | U3, U8 |
| 7  | `VitestSession.layer` `vitest-runner/src/VitestSession.service.ts:78`                                                                                                                  | static                                                              | clean                        | tier 3 (KTD3): `buildRuntime` → `VitestRuntime.handle.ts`/`.blueprint.ts` (`vitest/node`)                                          | `make` + `layer` → `vitest-session.ts`                                                                                                  | U8     |
| 8  | `mcpServerLayer` `stryker-js/src/Mcp/mcp-server.cell.ts:208`                                                                                                                           | cell export                                                         | n/a                          | cell; no driver reach; not `*Live`                                                                                                 | stays                                                                                                                                   | -      |
| 9  | `Sandboxes` `stryker-js/src/Sandbox.blueprint.ts:464`                                                                                                                                  | blueprint                                                           | n/a                          | cell                                                                                                                               | stays                                                                                                                                   | -      |
| 10 | `Sandbox.layer` `stryker-js/src/Sandbox.service.ts:87`                                                                                                                                 | static method                                                       | clean                        | tier 2, no driver reach                                                                                                            | stays                                                                                                                                   | -      |
| 11 | `IdGenerator.layer` `stryker-js/src/Worker.service.ts:21`                                                                                                                              | static                                                              | clean                        | tier 2                                                                                                                             | stays                                                                                                                                   | -      |
| 12 | `GitDiff.layer` `stryker-js/src/git-diff.service.ts:177`                                                                                                                               | static                                                              | clean                        | tier 2 (spawner tag left in `R`)                                                                                                   | stays                                                                                                                                   | -      |
| 13 | `MutationReporting.layer` `stryker-js/src/mutation-reporting.service.ts:160`                                                                                                           | static                                                              | clean                        | tier 2                                                                                                                             | stays (Stream D)                                                                                                                        | -      |
| 14 | `makeNodePlatformLayer`, `nodePlatformLayer` `stryker-js/src/node-platform.ts:133,143`                                                                                                 | module-level                                                        | n/a                          | tier 3 Node platform composition (ADR-0003:41); lazy values, no `*Live`                                                            | stays                                                                                                                                   | -      |
| 15 | `OutputModeProbeLive` `stryker-js/src/output-mode-probe.service.ts:130`                                                                                                                | `*Live` alias of `OutputModeProbe.layer`                            | refused 130:1                | violates R1                                                                                                                        | delete; `bin/main.ts:40,147` use `OutputModeProbe.layer`                                                                                | U1     |
| 16 | `layer` `stryker-js/src/oxc-source-parser.ts:50`                                                                                                                                       | module-level                                                        | n/a                          | tier 3 (ADR-0003 exemplar)                                                                                                         | stays                                                                                                                                   | -      |
| 17 | `ProjectFiles.layer` `project-files.service.ts:50`, `ReporterOutput.layer` `reporter-output.service.ts:33`, `Reporter.layer` `reporter.service.ts:43`                                  | static                                                              | clean                        | tier 2                                                                                                                             | stay                                                                                                                                    | -      |
| 18 | `MachineConsole.layer` `stryker-js/src/reporting/machine-console.service.ts:200`                                                                                                       | static                                                              | clean                        | tier 2                                                                                                                             | stays                                                                                                                                   | -      |
| 19 | `MachineConsole.captureLayer` same file `:205`                                                                                                                                         | static field `*Layer`                                               | refused 205:3                | pure, wrong name (R14)                                                                                                             | rename → `layerCapture`; `Mcp/mcp-server.cell.ts:142`, `bin/main.ts:237`                                                                | U1     |
| 20 | `RunEventDrain.layer` `stryker-js/src/run-event-stream.service.ts:115`                                                                                                                 | static                                                              | clean                        | tier 2                                                                                                                             | stays                                                                                                                                   | -      |
| 21 | `RunEventDrain.fileLayer` same file `:128`                                                                                                                                             | static field `*Layer`                                               | refused (round 2) 128-138    | pure (`Stdio`/`FileSystem`/`Path` tags), wrong name                                                                                | rename → `layerFile`; `bin/main.ts:148-149`                                                                                             | U1     |
| 22 | `RunEventDrainLive` same file `:141`                                                                                                                                                   | `*Live` alias                                                       | (round 2, same file)         | violates R1                                                                                                                        | delete; `RunEvent/mod.ts:11`, `run/run-stages.ts:12,29`, `tests/run-event-stream.integration.test.ts:164,414` use `RunEventDrain.layer` | U1     |
| 23 | `RunEventStreamPortTag.layer` same file `:396`                                                                                                                                         | static                                                              | clean                        | tier 2                                                                                                                             | stays                                                                                                                                   | -      |
| 24 | `WorkerReportsLive` `stryker-js/src/run-events.service.ts:31`                                                                                                                          | module-level `*Live`                                                | refused (round 3) 31-55      | pure, belongs on the class (R3)                                                                                                    | → `static readonly layer` on `WorkerReports`; `run/RunEnvironment.service.ts:24,112`                                                    | U1     |
| 25 | `RunEnvironment.stage` `stryker-js/src/run/RunEnvironment.service.ts:41`                                                                                                               | static method named `stage`                                         | clean                        | tier 2, pure, wrong member name (R4)                                                                                               | rename → `layer`; 21 call-site files (U1)                                                                                               | U1     |
| 26 | `PhaseClock.layer` `stryker-js/src/run/phase-clock.service.ts:41`                                                                                                                      | static                                                              | clean                        | tier 2                                                                                                                             | stays                                                                                                                                   | -      |
| 27 | `runRequestCell` `run-request.cell.ts:607`, `strykerCell` `run/run-stages.ts:32`, `make` `spawned-socket-worker.handle.ts:25`, `layerWorkerProtocol` `worker-protocol.blueprint.ts:79` | cell kinds                                                          | n/a                          | cells                                                                                                                              | stay (`run-stages.ts` edits for row 22)                                                                                                 | -      |
| 28 | `BakedFixtureCache.layer` `test/e2e/src/Harness/fixture-cache.service.ts:814`                                                                                                          | static                                                              | clean                        | tier 3 (KTD3): `Warm.boot` (`:768`) → microsandbox                                                                                 | `make` + `layer` → `fixture-cache.ts`                                                                                                   | U10    |
| 29 | `GuestJobs.layer` `test/e2e/src/Harness/guest-job.service.ts:35`                                                                                                                       | static, service imports `MicroVM` at runtime (`:1`, `:43`)          | clean (preset lacks it)      | tier 3: `MicroVM.job(...)`; breaks R2                                                                                              | `make` + `layer` → `guest-job.ts`; service keeps `import type { MicroVM }` and its constants                                            | U10    |
| 30 | `layer` `test/e2e/src/Harness/harness-telemetry.service.ts:23`                                                                                                                         | module-level in `*.service.ts`, built by `TestTelemetry.layer(...)` | clean (not a `Layer.*` call) | concrete OTLP exporter (`@systemfsoftware/vitest-config/telemetry`); breaks R1 and R2                                              | moves into the root `harness-layers.ts`; the service keeps `SpanNames`/`seamSpan`/`withSeamSpan`                                        | U10    |
| 31 | `StrykerCliRunner.layer` `test/e2e/src/Harness/stryker-cli-runner.service.ts:102`                                                                                                      | static                                                              | clean                        | tier 3 (KTD3): `Warm.fork`/`Warm.exec` (`:62-63`, `:77-78`)                                                                        | `make` + `layer` → `stryker-cli-runner.ts`                                                                                              | U10    |
| 32 | `HarnessServicesLive`, `HarnessPlatformLive` `test/e2e/src/Harness/harness-layers.ts:11,13`                                                                                            | tier 1                                                              | n/a                          | composition root (KTD5)                                                                                                            | stay; import the new siblings                                                                                                           | U10    |

Not Layer exports, but on the same path:

- `src/drivers/` modules: `instrumenter/src/drivers/oxc-program.ts` (no driver import; takes an `Oxc` value; importer `FrameworkEntry.ts:15`), `vitest-runner/src/drivers/vitest-node.ts` (type-only `vitest/node`; importers `VitestRunner.service.ts:20`, `VitestRuntime.blueprint.ts:19`, `VitestRuntime.handle.ts:31`) and `vitest-runner/src/drivers/vitest-pool.ts` (runtime `ThreadsPoolWorker` from `vitest/node`; importer `StandbyThreadsPool.handle.ts:20`). Each moves flat with its basename kept (R6, U8, U9).
- `instrumenter/src/Parser.service.ts` has no Service class and no Layer, but loads `oxc-parser` through `import()` (`:37`) and has a type import of it (`:34`). It breaks R2, so it becomes `Parser.ts`. Importers: `Format.schema.ts:7` (type), `Format.ts:22`, `FrameworkEntry.ts:23`, `Instrument/mod.ts:12` (type re-export), `InstrumentHeader.ts:9`, `Transformer.service.ts:82` (type), `drivers/oxc-program.ts:3` (type). Importers that only take `ParseFailed` import it from `Parser.schema.ts`, its declaring module (U9).

### Public API Impact

| Package (version)                                                      | Change                                                                                                                                                                                                      | api report entry                                                                                                                     | Bump                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `stryker-js` (19.0.0)                                                  | remove `RunEvent.RunEventDrainLive`                                                                                                                                                                         | `etc/stryker-js.api.md:49` (namespace `RunEvent` export list)                                                                        | major                  |
| `stryker-js`                                                           | `RunEvent.RunEventDrain.fileLayer` → `layerFile`                                                                                                                                                            | none (class members are not in the report; `RunEventDrain` is at `:49`)                                                              | major (same changeset) |
| `stryker-js`                                                           | `Engine.RunEnvironment.stage` → `layer`                                                                                                                                                                     | none (`RunEnvironment` is at `:19`, members not reported)                                                                            | major (same changeset) |
| `stryker-js-plugin-runtime` (7.0.4)                                    | `Worker.WorkerOptions.layer` → `layerConfig`, `Worker.WorkerTelemetry.layer` → `layerConfig`                                                                                                                | none (`WorkerOptions`, `WorkerTelemetry` at `etc/stryker-js-plugin-runtime.api.md:14`, members not reported); `README.md:60` updated | major                  |
| `stryker-js-typescript-checker` (8.3.2)                                | `./runtime`: `CheckerRuntime.layer(options)` replaced by `TypeScriptCheckerRuntime.layer(options)` (`export * as TypeScriptCheckerRuntime from '../typescript-checker-runtime.js'` in `src/runtime/mod.ts`) | none: `etc/stryker-js-typescript-checker.api.md` covers only `.` (`strykerPlugins`), not `./runtime`; `README.md:44,47` updated      | major                  |
| `stryker-js-vitest-runner` (9.0.2), `stryker-js-instrumenter` (13.0.0) | internal moves only                                                                                                                                                                                         | unchanged                                                                                                                            | none                   |

`OutputModeProbeLive`, `MachineConsole`, `WorkerReports`, `VitestSession`, `trace-context-rpc` paths and `Parser` paths are not reachable from any exports map. That was checked against each package's `exports` keys and api report.

### PR Body Contract (R12)

Each PR body carries:

- A table with columns Layer, tier, file, and why, holding the inventory rows that PR touches.
- **How an agent consumes this.** PR A: run `pnpm lint:conventions`, or `./bin/gritlint check --format json` for structured output. A finding carries `ruleId: cell-architecture/service-exports-no-layer`, `reasonCode: service-exports-layer`, a `nextAction`, and a `location` with the range of the offending import or Layer. Exit 0 is clean and 1 means findings. The fix is to move the driver import and every Layer built from it into a module beside the service that only composition roots and tests import, and to keep at most a pure `static readonly layer` on the class. Also in PR A: the renamed stryker-js members and the stryker-js major. PR B: each moved implementation's new module and its root wiring, plus the plugin-runtime and typescript-checker majors and their replacements.
- **Known gaps** (PR A): the Gate Follow-ups below.

## Implementation Units

| U-ID | Title                                                   | Files touched (primary)                                                                                                                                                                             | Depends on |
| ---- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| U1   | stryker-js aliases out, layer names per R4              | `packages/stryker-js/src/{output-mode-probe,run-event-stream,run-events}.service.ts`, `reporting/machine-console.service.ts`, `run/RunEnvironment.service.ts`, 21 `RunEnvironment.stage` call sites | -          |
| U2   | plugin-runtime trace adapter out of `*.service.ts`      | `packages/stryker-js-plugin-runtime/src/trace-context-rpc.ts`                                                                                                                                       | -          |
| U3   | vitest-runner TestRunner adapter out of `*.service.ts`  | `packages/stryker-js-vitest-runner/src/vitest-test-runner.ts`, `VitestRunner.schema.ts`                                                                                                             | -          |
| U4   | Enrol the cell-architecture pack, re-lock gritlint      | `gritlint.json`, `flake.lock`                                                                                                                                                                       | U1-U3      |
| U5   | Pin the systemfsoftware packs                           | `.compound-engineering/config.yaml`                                                                                                                                                                 | -          |
| U6   | plugin-runtime `layerConfig`                            | `packages/stryker-js-plugin-runtime/src/worker-{options,telemetry}.service.ts`, runner and checker `main.ts`                                                                                        | PR A       |
| U7   | typescript-checker runtime beside its service           | `packages/stryker-js-typescript-checker/src/typescript-checker-runtime.ts`, `runtime/mod.ts`                                                                                                        | U6         |
| U8   | vitest-runner session at the root, `drivers/` flat      | `packages/stryker-js-vitest-runner/src/vitest-session.ts`, `main.ts`, `vitest-node.ts`, `vitest-pool.ts`                                                                                            | U3, U6     |
| U9   | instrumenter parser module, `drivers/` flat             | `packages/stryker-js-instrumenter/src/Parser.ts`, `oxc-program.ts`                                                                                                                                  | -          |
| U10  | e2e harness sandbox-backed layers beside their services | `test/e2e/src/Harness/{guest-job,fixture-cache,stryker-cli-runner}.ts`, `harness-layers.ts`                                                                                                         | -          |

### PR A - gate on (`stream-a/cell-layer-placement`)

#### U1. stryker-js: aliases out, layer names per R4

- **Goal:** inventory rows 15, 19, 21, 22, 24 and 25.
- **Requirements:** R1, R3, R4 (names), R7, R13.
- **Files:** `packages/stryker-js/src/output-mode-probe.service.ts`, `src/bin/main.ts`, `src/reporting/machine-console.service.ts`, `src/Mcp/mcp-server.cell.ts`, `src/run-event-stream.service.ts`, `src/RunEvent/mod.ts`, `src/run/run-stages.ts`, `src/run-events.service.ts`, `src/run/RunEnvironment.service.ts`. `RunEnvironment.stage` call sites: `src/Serve/Serve.cell.ts`, `src/audit-request.cell.ts`, `src/plan-request.cell.ts`, `src/run-request.cell.ts`, `tests/__fixtures__/check-cost-workspace.fixture.ts`, and the `tests/*.integration.test.ts` files named `compile-error-reuse`, `cost-model`, `diff-scope`, `dry-run-coverage-across-roots`, `framework-run`, `incremental-report-roundtrip`, `incremental-reuse`, `mutant-location-parity`, `plugin-mutator-provider`, `readmit-subsumed`, `sarif-reporter`, `slow-reporter-terminal-report`, `uncovered-mutant-checking` and `wall-clock-timeout`. Also `tests/run-event-stream.integration.test.ts`, `docs/solutions/runtime-errors/stage-scope-closed-with-exit-void-hides-run-outcome.md:37` (DEL1: it names `RunEnvironment.stage`), `etc/stryker-js.api.md`, and one `.changeset/*.md` (`"@systemfsoftware/stryker-js": major`).
- **Approach:** delete the two `*Live` aliases. Move `WorkerReportsLive`'s body unchanged into `static readonly layer` on `WorkerReports`. Rename `captureLayer`→`layerCapture`, `fileLayer`→`layerFile` and `stage`→`layer`, updating every call site and the solution doc, then run `pnpm --filter @systemfsoftware/stryker-js api:update`.
- **Test scenarios:** no new test (KTD7). These existing tests show behaviour is unchanged:
  - `tests/run-event-stream.integration.test.ts`: drain on stdout and on a failing stdio, through `RunEventDrain.layer`.
  - `tests/compile-error-reuse.integration.test.ts`: worker reports through `RunEnvironment.layer`.
  - `tests/mcp-server.integration.test.ts`: machine console capture.
  - `tests/break-threshold-exit.integration.test.ts` and `tests/gate.integration.test.ts`: the CLI root with `OutputModeProbe.layer` and `RunEventDrain.layerFile`.
  - The 21 `RunEnvironment.stage` call sites, by their own suites.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js typecheck test api:check`; AE1.

#### U2. plugin-runtime: trace adapter out of `*.service.ts`

- **Goal:** inventory rows 1-2.
- **Requirements:** R1, R2.
- **Files:** `packages/stryker-js-plugin-runtime/src/trace-context-rpc.service.ts` → `src/trace-context-rpc.ts`, `src/Trace/mod.ts:1`, `src/worker-server.blueprint.ts:18`; one changeset (`"@systemfsoftware/stryker-js-plugin-runtime": none`, since the export names and `Trace` namespace are unchanged).
- **Approach:** `git mv` the module and update its two importers.
- **Test scenarios:** no new test. The trace middleware is exercised on both sides by `packages/stryker-js/tests/trace-propagation.integration.test.ts`, `checker-rpc.integration.test.ts`, `mutant-deadline.integration.test.ts` and `worker-connection-loss.integration.test.ts`.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js-plugin-runtime typecheck test api:check` (the api report is unchanged).

#### U3. vitest-runner: TestRunner adapter out of `*.service.ts`

- **Goal:** inventory row 6 (the file move; U8 does the session wiring).
- **Requirements:** R1.
- **Files:** `packages/stryker-js-vitest-runner/src/VitestRunner.service.ts` → `src/vitest-test-runner.ts`; `src/VitestRunner.schema.ts` gains the `RunFilter` interface (`VitestRunner.service.ts:133-138`); `src/MutantRun.cell.ts:12`; `src/main.ts:16`; one changeset (`"@systemfsoftware/stryker-js-vitest-runner": none`).
- **Approach:** `git mv` the module. Move `RunFilter` so the cell no longer imports from an adapter module (ADR-0003:36). Update `main.ts`'s import.
- **Test scenarios:** no new test. `tests/dry-run-module-evidence.integration.test.ts` and `tests/kill-first-ordering.integration.test.ts` spawn the worker built from `main.ts`.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js-vitest-runner typecheck test build` (PLUG-1).

#### U4. Enrol the cell-architecture pack, re-lock gritlint

- **Goal:** R8 and R9.
- **Dependencies:** U1-U3 (G3: those fixes are what the gate needs).
- **Files:** `gritlint.json` (`packs` gains `"cell-architecture": {}`), `flake.lock` (gritlint node only).
- **Approach:** run `nix flake update gritlint`. Confirm the new `rev` descends from `fe886c5` and that the `git diff flake.lock` hunk touches only `nodes.gritlint`. Add the pack. No ignore entries and no overrides.
- **Test scenarios:** the planted probe (AE3), not committed. With the pack deleted from a scratch `gritlint.json`, the planted module passes, which shows the enrolment is what refuses it.
- **Verification:** `pnpm lint:conventions` exits 0 with `findings: 0` and no unparseable module. AE3 is recorded verbatim in the PR body. CI `check` is green.

#### U5. Pin the systemfsoftware packs

- **Goal:** R10.
- **Files:** `.compound-engineering/config.yaml`.
- **Approach:** replace the three `tree/main` URLs with one entry: `source: https://github.com/systemfsoftware/systemfsoftware`, `ref: 02bf9653b1ca2b0a2951baf2743bb3f70d19fc77`, `path: compound-packs`, `pack: [cell-architecture, boundary-testing, schema-laws]`.
- **Test scenarios:** the CE pack resolver (`skills/ce-brainstorm/scripts/packs-resolve.py`), run from the repo root, returns three roots at that ref with empty `errors`.
- **Verification:** the resolver output is recorded in the PR body.

### PR B - placement the gate cannot see (`stream-a/cell-layer-adapters`, stacked on PR A)

#### U6. plugin-runtime: `layerConfig`

- **Goal:** inventory rows 3-4 (Q2).
- **Requirements:** R5, R13.
- **Files:** `packages/stryker-js-plugin-runtime/src/worker-options.service.ts`, `src/worker-telemetry.service.ts`, `README.md:60`; root callers `packages/stryker-js-vitest-runner/src/main.ts:46,49` and `packages/stryker-js-typescript-checker/src/main.ts:47,50`; one changeset (`"@systemfsoftware/stryker-js-plugin-runtime": major`).
- **Approach:** rename both `layer` members to `layerConfig`, then update the four root call sites and the README.
- **Test scenarios:** no new test. `packages/stryker-js-vitest-runner/tests/dry-run-module-evidence.integration.test.ts` and `kill-first-ordering.integration.test.ts` spawn the runner worker, whose root reads both layers.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js-plugin-runtime --filter @systemfsoftware/stryker-js-vitest-runner --filter @systemfsoftware/stryker-js-typescript-checker typecheck test api:check`.

#### U7. typescript-checker: runtime implementation beside its service

- **Goal:** inventory row 5 (Q1).
- **Requirements:** R4, R13.
- **Dependencies:** U6 (the same `main.ts`).
- **Files:** `packages/stryker-js-typescript-checker/src/CheckerRuntime.service.ts`, new `src/typescript-checker-runtime.ts`, `src/runtime/mod.ts`, `src/main.ts:43`, `README.md:44,47`, `tests/check-mutants.integration.test.ts:102`, `tests/program-digest.integration.test.ts:211`, `test/e2e-core/tests/concurrency-checker.integration.test.ts:11,117`, `test/e2e-core/tests/placement.integration.test.ts:151`; one changeset (`"@systemfsoftware/stryker-js-typescript-checker": major`).
- **Approach:**
  - Move `makeChecker`, `refuse` and the layer body into `typescript-checker-runtime.ts` as module-level `make(options, compiler)` and `layer(options)`. The layer keeps `Layer.provideMerge(makeCompilerBlueprint(options).layer(TypeScriptCompiler))` and its exact type.
  - `CheckerRuntime.service.ts` keeps the class and `CheckerRuntimeShape`, with type-only imports.
  - `runtime/mod.ts` adds `export * as TypeScriptCheckerRuntime from '../typescript-checker-runtime.js'`.
- **Test scenarios:** no new test. `check-mutants.integration.test.ts` and `program-digest.integration.test.ts` cover checker verdicts and program digest through the moved layer. `test/e2e-core/tests/concurrency-checker.integration.test.ts` and `placement.integration.test.ts` cover the public `./runtime` path.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js-typescript-checker typecheck test api:check`; `pnpm --filter ./test/e2e-core typecheck test`; AE4.

#### U8. vitest-runner: session at the root, `drivers/` flat

- **Goal:** inventory row 7 and the rest of row 6, plus the two vitest `drivers/` modules (Q1 for row 7).
- **Requirements:** R4, R6.
- **Dependencies:** U3, U6 (the same `main.ts`).
- **Files:** `packages/stryker-js-vitest-runner/src/VitestSession.service.ts`, new `src/vitest-session.ts`, `src/vitest-test-runner.ts`, `src/main.ts:38-44`, `src/drivers/vitest-node.ts` → `src/vitest-node.ts`, `src/drivers/vitest-pool.ts` → `src/vitest-pool.ts`, `src/vitest-test-runner.ts` (import of `vitest-node`), `src/VitestRuntime.blueprint.ts:19`, `src/VitestRuntime.handle.ts:31`, `src/StandbyThreadsPool.handle.ts:20`; the changeset from U3 still covers it (`none`).
- **Approach:**
  - Move the `VitestSession.layer` body and its private helpers (`decodeOptions`, `assembleShape`, `closeOnShutdown`, `buildRuntime`) into `vitest-session.ts` as `make(input)` and `layer(input)`. `VitestSession.service.ts` keeps the class, `VitestSessionInput` and `VitestSessionShape`.
  - `vitest-test-runner.ts`'s `layer(input)` drops `Layer.provide(VitestSession.layer(input))`.
  - In `main.ts`, the one `Layer.unwrap` that reads `WorkerOptions` and `STRYKER_SANDBOX_DIR` (`:38-44`) builds a single `input`. It returns `vitestTestRunner.layer(input).pipe(Layer.provide(vitestSession.layer(input)))`, so one session is built per worker, as before (KTD5).
- **Test scenarios:** no new test. Coverage comes from `tests/dry-run-module-evidence.integration.test.ts` and `tests/kill-first-ordering.integration.test.ts` (the worker built from `main.ts`), from `src/__tests__` (unchanged), and from `packages/stryker-js/tests/vm-runner.integration.test.ts` plus `vm-parity.differential.test.ts`.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js-vitest-runner typecheck test build` (PLUG-1: the bundle still imports only node builtins and `vitest`); AE2 for this package.

#### U9. instrumenter: parser module out of `*.service.ts`, `drivers/` flat

- **Goal:** `Parser.service.ts` and `drivers/oxc-program.ts`.
- **Requirements:** R2, R6.
- **Files:** `packages/stryker-js-instrumenter/src/Parser.service.ts` → `src/Parser.ts`; importers `Format.schema.ts:7`, `Format.ts:22`, `FrameworkEntry.ts:15,23`, `Instrument/mod.ts:12`, `InstrumentHeader.ts:9`, `Transformer.service.ts:82`; `src/drivers/oxc-program.ts` → `src/oxc-program.ts`; one changeset (`"@systemfsoftware/stryker-js-instrumenter": none`).
- **Approach:** `git mv` both files and update the import specifiers. `Transformer.service.ts` and `InstrumentHeader.ts` take `ParseFailed` from `Parser.schema.ts`.
- **Test scenarios:** no new test. Coverage comes from `tests/framework-format.integration.test.ts` (`frameworkEntryOf` through `oxc-program.ts` and `loadOxc`), `tests/mutant-span-slice.integration.test.ts`, and the instrumenter's full suite (`parseJS`/`parseTS`/`parseTsx` through `Format.ts`).
- **Verification:** `pnpm --filter @systemfsoftware/stryker-js-instrumenter typecheck test api:check` (the api report is unchanged); AE2.

#### U10. e2e harness: sandbox-backed layers beside their services

- **Goal:** inventory rows 28-32 (Q1 for rows 28 and 31).
- **Requirements:** R1, R2, R4.
- **Files:** `test/e2e/src/Harness/guest-job.service.ts`, new `guest-job.ts`; `fixture-cache.service.ts`, new `fixture-cache.ts`; `stryker-cli-runner.service.ts`, new `stryker-cli-runner.ts`; `harness-telemetry.service.ts`; `harness-layers.ts`.
- **Approach:** each `*.service.ts` keeps its Service class, Shape, static constants and type-only imports (`import type { MicroVM }`). Each implementation (`make`, `layer`, and the private helpers only it uses) moves to its sibling. `harness-telemetry.service.ts`'s `layer` (`TestTelemetry.layer({...})`) moves verbatim into `harness-layers.ts`. That root then imports the three siblings' `layer` in place of the static members.
- **Test scenarios:** no new test. `test/e2e/tests/*.e2e.test.ts` run in CI's `e2e` job on every non-docs PR (`.github/workflows/ci.yml:305-307`; OP27: not run locally). `test/e2e` typecheck runs locally.
- **Verification:** `pnpm --filter @systemfsoftware/stryker-e2e typecheck`; CI `e2e` green; AE4.

## Verification Contract

- Per PR: `pnpm format:check`, `pnpm typecheck`, `pnpm test` for the touched packages, `pnpm check:ci` (START-1 to START-4). After U4, `check:ci` includes `pnpm lint:conventions` with the pack on.
- After PR A: AE1, AE3. After PR B: AE2, AE4, and `pnpm lint:conventions` still exits 0.
- `git grep -nI -e OutputModeProbeLive -e RunEventDrainLive -e WorkerReportsLive -e 'RunEnvironment\.stage' -- . ':!*.lock' ':!**/CHANGELOG.md' ':!docs/plans/**' ':!docs/adr/**'` exits 1 (DEL1; ADRs are immutable records).
- No mutation run locally; mutants are judged on main's CI.

## Definition of Done

- Every row in the Layer Inventory either sits at its target or is marked "stays" with its reason, and both PRs are green on CI at their head SHAs.
- `src/drivers/` is absent from every package. `gritlint.json` enrols `cell-architecture`, the gritlint lock descends from `fe886c5`, and `pnpm lint:conventions` exits 0.
- The planted-probe transcript is in PR A's body. `.compound-engineering/config.yaml` pins `02bf9653b1`.
- Changesets: stryker-js `major` (PR A); plugin-runtime `none` (PR A) and `major` (PR B); typescript-checker `major` (PR B); vitest-runner and instrumenter `none`.
- No throwaway probe, planted file or scratch config remains in any diff.

## Gate Follow-ups

These are recorded for systemfsoftware/gritlint and not fixed here (no PR or push there).

- F1. The driver preset misses `oxc-parser` (`instrumenter/src/Parser.service.ts:37`, `import()`), `@systemfsoftware/effect-microsandbox` (`test/e2e/src/Harness/guest-job.service.ts:1`), `vitest`, `typescript` and `@opentelemetry/*`. Both modules above pass the gate today.
- F2. A module-level Layer built by a vendor's `.layer(...)` call (`harness-telemetry.service.ts:23`, `TestTelemetry.layer(...)`) is not refused. R12 matches `Layer.*` calls, `*Live` and Layer aliases only.
- F3. One finding per directory: three rounds were needed to see all six refused files (G2). A per-file finding would show the whole debt at once.
- F4. A Layer member named outside R4 (`RunEnvironment.stage`), and a `layer` that reads `Config`, are not refused. R14 checks only `*Layer` and `*Live`.
- F5. Reach through a handle or blueprint (KTD3) is invisible to R12 by design (R13). Only review catches it.
- F6. Concrete runtime layers supplied outside a root or service file: `stryker-js-html-reporter/src/html-reporter.ts:60` (`Layer.build(nodeFsPathLayer)`) and `stryker-js/src/Serve/Serve.cell.ts:569` (`NodeSocketServer.layer`). This is pack rule R8 territory, outside `*.service.ts`.
- F7. Edges into a driver-backed module from outside a root: `plugin-runtime/src/worker-server.blueprint.ts:18` (trace server middleware), `stryker-js/src/worker-client.blueprint.ts:58` (`Trace.layerTraceContextClient`), and the instrumenter's `Format.ts`, `FrameworkEntry.ts` and `InstrumentHeader.ts` into `Parser.ts` (no parser Service exists; the `SourceParser` precedent is ADR-0003:41). `test/e2e/src/Harness/harness-failure.schema.ts` imports microsandbox from a schema module.

## Open Questions

Deferred to the supervisor. None blocks execution; each has a default chosen above.

- Q1. KTD3 moves four handle- or blueprint-backed static layers (rows 5, 7, 28, 31). That adds the typescript-checker major. Reading R13 alone would leave them on the class. Default: move.
- Q2. Rows 3-4 rename `layer`→`layerConfig` (plugin-runtime major) by R5. Default: rename.
- Q3. F7's blueprint→adapter edges stay in this unit as known gaps. Default: record only.
