---
title: Dissolve test/e2e-core into the e2e harness, the bench and the product contract - Plan
type: refactor
date: 2026-10-13
topic: dissolve-e2e-core
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan
execution: code
---

# Dissolve test/e2e-core - Plan

## Goal Capsule

No package, directory or workspace entry is named `e2e-core`, and no other core/common/shared/utils package takes over its test tooling. E2e harness code lives in `test/e2e`, bench code lives in `test/bench`, and code that decodes a published product output lives in that product's contract package, tested there as product code. The work lands as four small PRs in one stack on `main`.

Review status: the root reviews this plan (r42 gate, refreshed by the root order of 04:08). The refresh applies the root's six corrections of 22:25 (section "Root corrections applied"). Facts not confirmed by a command run against `origin/main` are marked [unverified].

## Product Contract

### Requirements

- R1. No package, directory or workspace entry named `e2e-core`, and no replacement core/common/shared/utils package for test tooling. New commits stop using the `e2e-core` scope; past commit messages are history and stay.
- R2. E2e harness code lives in `test/e2e`; bench code lives in `test/bench`.
- R3. Code that decodes a published product output lives in its contract package, with property tests that can fail on a plausible bug and no mockery.
- R4. Every e2e journey and every bench comparison keeps its current verdict. The one exception is the bench comparison whose subject is this package (D2).
- R5. #306's fixture-manifest key refusal and #311's committed-lock bake still hold.
- R6. Product tests (`packages/*/tests`) import no test-harness package and name no test-harness project.
- R7. Mutation grades the shipped product only: test tooling leaves `mutation.yml`, `kill-matrix.yml` and the product test that mirrors Mutation's project list.
- R8. A harness test survives only if a person running the e2e lane or the bench relies on what it checks. The inventory gives a keep, move or delete reason for each file.
- R9. Other streams' open PRs land after the cut by merging `main`. This stream edits none of them.

### Done (all must hold)

- `git grep -nI -e e2e-core -- . ':!*.lock' ':!pnpm-lock.yaml' ':!docs/plans' ':!docs/brainstorms' ':!packages/stryker-js/tests/__fixtures__/lockfile-closure/real'` returns nothing (exit 1).
- `pnpm-workspace.yaml` and the lockfile have no `test/e2e-core` importer.
- Every moved law and suite passes in its receiving lane under the same `describe`/`it` name, so a renamed or dropped test shows up in the diff of names.
- `pnpm test` and `check:ci` still run no container journey (E2E-1's purpose).
- The first `main` Mutation run after PR A plans shards for the three product projects only.
- CI is green on the exact head of each PR, with the moved tests shown running (task cache miss, or their names in the job log).

### Does not count

- Renaming the package (`test/harness-common`, `test/shared`, a `test-utils` package): the grab-bag survives under a new name (R1).
- Re-export shims, path aliases or a forwarding `mod.ts` left at the old location (DEL1).
- Deleting or skipping a test to make a move easier. A delete needs an R8 reason in the inventory.
- Moving harness tests into `packages/*` so that they are mutation-graded, or so that a product package kills mutants with harness code.
- Local mutation runs of any kind.
- Editing another stream's open PR, `release.jsonc`, or adding a changeset only to pass a gate.

### Scope Boundaries

- Not here: fixing the flaky `∀x_ManifestDocument_=x` law. It moves unchanged and keeps running (P12).
- Not here: enrolling `stryker-js-cli-contract` in Mutation. `mutation.yml` and `kill-matrix.yml` belong to Stream K (P4, correction 2).
- Not here: editing Stream B's reuse suites beyond the one data line D4 names.
- `docs/plans/**`, `docs/brainstorms/**` and the committed lockfile snapshots under `packages/stryker-js/tests/__fixtures__/lockfile-closure/real/` keep the name; they are dated records or frozen test inputs. Live docs change: `test/e2e/AGENTS.md` (4 mentions), `test/e2e/README.md`, `test/e2e/oxlint.config.ts`, `docs/solutions/build-errors/e2e-bake-resolved-an-npm-alias-edge-from-the-registry.md` and `docs/solutions/test-failures/stream-schema-must-not-carry-json-rest-records.md` (each names the package on `origin/main` at `381b3f5b1`).

## Root corrections applied (22:25)

1. **The product test names the project; it does not import the package.** `packages/stryker-js/tests/lockfile-closure-digest.integration.test.ts:29-34` hard-codes `'test/e2e-core'` in `MUTATED_PROJECTS`, and `:121-123` reads each listed project's `package.json`. The line changes in the same commit as `mutation.yml` `PROJECTS` (PR A, D4). Otherwise its live-lockfile scenario reads a manifest that no longer exists once PR D deletes the package.
2. **`stryker-js-cli-contract` is not in `mutation.yml` `PROJECTS`** (`:36` lists `packages/stryker-js`, `packages/stryker-js-typescript-checker`, `packages/stryker-js-vitest-runner` and `test/e2e-core`). So code moved into the contract package (PR C's stream codec) is not mutation-graded after the move. Its laws run in `pnpm test` but no mutant tests them until Stream K enrols the package. Today the same decoder sits in `test/e2e-core`, which is graded, so PR C trades a graded harness workflow for an ungraded contract codec, and the PR says so.
3. **Lint coupling.** `test/bench/oxlint.config.ts:1` is `export { default } from '../e2e-core/oxlint.config.ts'`, and `test/bench/tsconfig.node.json:11` references that file. `test/e2e/oxlint.config.ts:17` is the lint message telling `tests/` to import `@systemfsoftware/stryker-e2e-core`, and E2E-3 (`test/e2e/AGENTS.md:21`) names the package as a lawful import. PR B inlines the config into `test/bench/oxlint.config.ts` and drops the tsconfig reference; PR D rewrites the lint message and E2E-3 to name the new home.
4. **Workflow lines.** `kill-matrix.yml` names the project in its default `PROJECTS` inputs at `:9` and `:15`, and in its build cache key at `:82`. `mutation.yml` names it at `:36` (`PROJECTS`), `:43` (incremental report path), `:64` (incremental cache key) and `:118` (build cache key). All seven change in PR A.
5. **Exact inventory size** (`git ls-tree -r origin/main test/e2e-core` at `381b3f5b1`, 80 files): 29 `src` modules plus the `mod.ts` barrel, 13 `src/__tests__` laws, 7 `tests/*.test.ts` suites, 18 files under `tests/__fixtures__`, and 12 package-level files. Each has a row below.
6. **Pack and config claims are checked or marked.** See "Packs" and "Load-bearing premises"; anything not confirmed by a command against `origin/main` carries [unverified].

## Decisions (each needs the root's ruling)

- D1. **The bench imports the shared install modules from the e2e harness.** `catalog-resolution.ts` and `install-closure.{schema,workflow}.ts` are the only modules both lanes import (P6). They move to `test/e2e/src/Harness/`, and `@systemfsoftware/stryker-e2e` gains a source-only `exports` map for them, which `test/bench` imports. Rejected: a third package (the grab-bag again); a copy in each lane (two sources of the install rules); the bench owning them (the bake is the e2e harness's job; the bench only reuses the install plan).
- D2. **The bench corpus entry `test/e2e-core` (`test/bench/corpus.json:14`) is re-pointed to `test/bench`.** The new entry mutates `src/summarize-bench.workflow.ts` and runs its property test, the same workload shape as today (one workflow under its laws). The first bench run after D reports that comparison as `workload changed`, not a verdict, because its subject changes. Rejected: re-pointing to `test/e2e`, whose vitest config would put container journeys in the bench's path.
- D3. **E2E-1 is reworded, not dropped.** Today `test/e2e` MUST NOT declare a `test` script (`test/e2e/AGENTS.md:19`), and the rule's gate is `test/e2e-core/tests/status-closure.integration.test.ts`. After the cut, `test/e2e`'s `test` runs only the in-process suites (`src/__tests__`, `in-process/`) under their own vitest config; container journeys stay under `test:e2e`. The purpose holds: no container journey in `pnpm test`, `check:ci` or the macOS matrix. Whether a repo-checks guard also refuses a `test` script in `test/e2e` is [unverified] (a text search of `nix/` and `scripts/` on `main` found none, which does not rule out a check phrased differently); PR D checks first and asks the root before touching any such guard (GATE1).
- D4. **`MUTATED_PROJECTS` drops `test/e2e-core` in PR A, in the same commit as `mutation.yml:36`** (correction 1).
- D5. **The run-event stream decoder becomes a contract codec, not a workflow.** `RunEventStream` in `stryker-js-cli-contract` decodes a whole stdout text to `ReadonlyArray<RunEvent>`: blank lines skipped, the first undecodable line refused with its 1-based number. It encodes as one `RunEventWireLine` per event. A codec keeps the published package off `@systemfsoftware/effect-cell-types`: its dependencies are `@systemfsoftware/stryker-js-plugin-interface` and `effect` only (P11). Rejected: moving `decodeStream` as a `Workflow.make`, which adds that dependency to a published contract.

- D6. **The three fixture schemas become harness files, not moved `*.schema.ts`.** `tests/__fixtures__/npm-closure.schema.ts`, `placement-failure.schema.ts` and `placement-slice.schema.ts` exist today. A `git mv` would add three `*.schema.ts` under a test directory, which is `tests-own-no-schemas`' trigger (`:5`). PR D folds each into the fixture file that uses it, as a `*.fixture.ts` that does not export them as domain types (rule 3, `:17`), and the suites keep their names and verdicts. Rejected: a byte-for-byte move (re-adds the rule's trigger in this stream's own diff); promoting them to production schemas (they model harness inputs, not product concepts). If the root rules the move must stay byte-for-byte, D6 becomes a follow-up unit after PR D.

## Inventory: every file under `test/e2e-core`

`test/e2e/in-process/` is new: in-process suites that need implementation packages and no container. E2E-3's import ban covers `test/e2e/tests/**` only (`test/e2e/AGENTS.md:21`), so its scope is unchanged; its wording loses the package name (PR D).

### `src` modules (29, plus the `mod.ts` barrel)

| File                                  | Destination                                                                                                      | Reason                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/annotation.schema.ts`            | `test/e2e/src/Harness/`                                                                                          | annotation grammar the lane's oracle reads                                                                                                                                               |
| `src/bake-key.schema.ts`              | `test/e2e/src/Harness/`                                                                                          | bake cache (E2E-8)                                                                                                                                                                       |
| `src/bench-corpus.schema.ts`          | `test/bench/src/`                                                                                                | bench-only                                                                                                                                                                               |
| `src/bench-order.ts`                  | `test/bench/src/`                                                                                                | bench-only                                                                                                                                                                               |
| `src/bench-report.schema.ts`          | `test/bench/src/`                                                                                                | bench-only                                                                                                                                                                               |
| `src/bench-run.schema.ts`             | `test/bench/src/`                                                                                                | bench-only                                                                                                                                                                               |
| `src/bench-summary.schema.ts`         | `test/bench/src/`                                                                                                | bench-only; read by summarize and render                                                                                                                                                 |
| `src/catalog-resolution.schema.ts`    | `test/e2e/src/Harness/`                                                                                          | carries #306's fixture-manifest refusal; `ManifestDocument` (`:67`) is the schema whose generated law `∀x_ManifestDocument_=x` is flaky (P12); moves unchanged                           |
| `src/catalog-resolution.ts`           | `test/e2e/src/Harness/` (bench imports it, D1)                                                                   | shared by both lanes; the fixture install is the e2e harness's job                                                                                                                       |
| `src/closure-lock.ts`                 | `test/e2e/src/Harness/`                                                                                          | #311 committed-lock bake                                                                                                                                                                 |
| `src/closure.schema.ts`               | `test/e2e/src/Harness/`                                                                                          | witness/status closure vocabulary; also read by the in-process placement fixtures                                                                                                        |
| `src/confirm-annotations.workflow.ts` | `test/e2e/src/Harness/`                                                                                          | e2e-only                                                                                                                                                                                 |
| `src/covering-test-files.workflow.ts` | `test/bench/src/`                                                                                                | only `test/bench` imports it                                                                                                                                                             |
| `src/decode-report.workflow.ts`       | delete; `test/e2e/tests/__fixtures__/run-artifacts.fixture.ts` decodes with `Report.MutationTestResult` directly | the report contract is already product code in `stryker-js-plugin-interface`; the wrapper adds only a harness error carrying the file name                                               |
| `src/decode-stream.workflow.ts`       | `packages/stryker-js-cli-contract/src/run-event-stream.schema.ts`, rewritten as a codec (PR C, D5)               | product contract: "every non-empty stdout line is one `RunEventWireLine`" is a property of the published stream, whose line codec the contract already owns (`run-event-wire.schema.ts`) |
| `src/install-closure.schema.ts`       | `test/e2e/src/Harness/` (bench imports it, D1)                                                                   | shared; the e2e bake owns the install rules                                                                                                                                              |
| `src/install-closure.workflow.ts`     | `test/e2e/src/Harness/` (bench imports it, D1)                                                                   | shared; the e2e bake owns the install rules                                                                                                                                              |
| `src/key-material.ts`                 | `test/e2e/src/Harness/`                                                                                          | bake cache                                                                                                                                                                               |
| `src/match-annotations.workflow.ts`   | `test/e2e/src/Harness/`                                                                                          | e2e-only                                                                                                                                                                                 |
| `src/match.schema.ts`                 | `test/e2e/src/Harness/`                                                                                          | e2e-only                                                                                                                                                                                 |
| `src/missing-fixtures.workflow.ts`    | `test/e2e/src/Harness/`                                                                                          | bake cache                                                                                                                                                                               |
| `src/parse-annotations.workflow.ts`   | `test/e2e/src/Harness/`                                                                                          | e2e-only                                                                                                                                                                                 |
| `src/placement-closure.workflow.ts`   | `test/e2e/src/Harness/`                                                                                          | in-process placement check decision                                                                                                                                                      |
| `src/prune-stale-entries.workflow.ts` | `test/e2e/src/Harness/`                                                                                          | bake cache                                                                                                                                                                               |
| `src/read-bench-run.workflow.ts`      | `test/bench/src/`                                                                                                | bench-only                                                                                                                                                                               |
| `src/render-bench-report.workflow.ts` | `test/bench/src/`                                                                                                | bench-only                                                                                                                                                                               |
| `src/status-closure.workflow.ts`      | `test/e2e/src/Harness/`                                                                                          | E2E-1 gate decision                                                                                                                                                                      |
| `src/summarize-bench.workflow.ts`     | `test/bench/src/`                                                                                                | bench-only; D2's new bench subject                                                                                                                                                       |
| `src/witness-registry.ts`             | `test/e2e/src/Harness/`                                                                                          | e2e-only (`test/e2e/scripts/seed-status-fault.ts:6`)                                                                                                                                     |
| `src/mod.ts`                          | delete                                                                                                           | the barrel re-exports unrelated leaves; consumers import from the owning lane, and no barrel is added for test tooling                                                                   |

### `src/__tests__` laws (13)

| File                                            | Destination                 | Reason                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `catalog-resolution.workflow.property.test.ts`  | `test/e2e/src/__tests__/`   | keep: fixture manifests resolve `catalog:` specs or refuse                                                                                                                                                                                                                                       |
| `confirm-annotations.workflow.property.test.ts` | `test/e2e/src/__tests__/`   | keep: journey verdicts confirm annotations                                                                                                                                                                                                                                                       |
| `covering-test-files.workflow.property.test.ts` | `test/bench/src/__tests__/` | keep: bench sides pick covering tests from it                                                                                                                                                                                                                                                    |
| `decode-report.workflow.property.test.ts`       | delete                      | `∀m_ReportDocument_≡DecodedUnderTheReportContract` restates the contract schema's own decode (moves beside `Report.MutationTestResult` only if the plugin interface has no such law [unverified]); `∀t_…RefusedNamingTheFile` checks a field copy (boundary-testing `no-mocks-on-internal-glue`) |
| `match-annotations.workflow.property.test.ts`   | `test/e2e/src/__tests__/`   | keep: every reported mutant matches exactly one annotation (E2E-2)                                                                                                                                                                                                                               |
| `missing-fixtures.workflow.property.test.ts`    | `test/e2e/src/__tests__/`   | keep: bake rebuilds exactly the missing fixtures                                                                                                                                                                                                                                                 |
| `parse-annotations.workflow.property.test.ts`   | `test/e2e/src/__tests__/`   | keep: fixture authors write the grammar                                                                                                                                                                                                                                                          |
| `placement-closure.workflow.property.test.ts`   | `test/e2e/src/__tests__/`   | keep: in-process placement verdict                                                                                                                                                                                                                                                               |
| `prune-stale-entries.workflow.property.test.ts` | `test/e2e/src/__tests__/`   | keep: bake cache pruning                                                                                                                                                                                                                                                                         |
| `read-bench-run.workflow.property.test.ts`      | `test/bench/src/__tests__/` | keep: bench reads each run from it                                                                                                                                                                                                                                                               |
| `render-bench-report.workflow.property.test.ts` | `test/bench/src/__tests__/` | keep: the bench verdict a reviewer reads                                                                                                                                                                                                                                                         |
| `status-closure.workflow.property.test.ts`      | `test/e2e/src/__tests__/`   | keep: every status has one witness                                                                                                                                                                                                                                                               |
| `summarize-bench.workflow.property.test.ts`     | `test/bench/src/__tests__/` | keep: Δ, no-signal and regression math                                                                                                                                                                                                                                                           |

### `tests/*.test.ts` suites (7)

| File                                            | Destination            | Reason                                                                                                                                                                                                |
| ----------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/analyzer.differential.test.ts`           | `test/e2e/in-process/` | keep: differential oracle over the e2e fixtures' slices, run before a container is booked                                                                                                             |
| `tests/bench-decisions.integration.test.ts`     | `test/bench/tests/`    | keep: bench reads runs and covering tests from real stream and report text                                                                                                                            |
| `tests/concurrency-checker.integration.test.ts` | `test/e2e/in-process/` | keep in the harness: shares `ast-analyzer.ts`/`diagnostics.ts` with the analyzer oracle; moving it into the checker package would make it a killing test there and move that package's mutation score |
| `tests/fixture-manifests.integration.test.ts`   | `test/e2e/in-process/` | keep: R5, #306's refusal                                                                                                                                                                              |
| `tests/install-closure.integration.test.ts`     | `test/e2e/in-process/` | keep: R5, the offline install the committed-lock bake relies on                                                                                                                                       |
| `tests/placement.integration.test.ts`           | `test/e2e/in-process/` | keep: annotations land on real mutants in-process                                                                                                                                                     |
| `tests/status-closure.integration.test.ts`      | `test/e2e/in-process/` | keep: E2E-1's gate (`test/e2e/AGENTS.md:19`)                                                                                                                                                          |

### `tests/__fixtures__`

| File                                                                                                                                                     | Destination                                                                         | Reason                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `annotated/provider.mjs`, `annotated/slice.ts`, `annotated/src/arithmetic.ts`, `annotated/src/effect-concurrency.ts`, `annotated/tsconfig.json`          | `test/e2e/in-process/__fixtures__/annotated/`                                       | test partners of the in-process oracles                                    |
| `ast-analyzer.ts`, `diagnostics.ts`, `metamorphic.ts`, `placement-slices.ts`, `rendered-failure.ts`, `slice-mutators.ts`, `slice-sources.ts`, `types.ts` | `test/e2e/in-process/__fixtures__/`                                                 | test partners of the in-process oracles                                    |
| `effect-concurrency/fixture-project.js`, `effect-concurrency/tsconfig.json`                                                                              | `test/e2e/in-process/__fixtures__/effect-concurrency/`                              | test partners of the in-process oracles                                    |
| `npm-closure.schema.ts`, `placement-failure.schema.ts`, `placement-slice.schema.ts`                                                                      | folded into the `test/e2e/in-process/__fixtures__/*.fixture.ts` that uses each (D6) | harness schemas of the suites that use them; `tests-own-no-schemas` rule 3 |

### Package-level files

| File                                                                                                                        | Destination                                         | Reason                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHANGELOG.md`                                                                                                              | delete                                              | private package history; the package ends                                                                                                               |
| `oxlint.config.ts`                                                                                                          | content inlined into `test/bench/oxlint.config.ts`  | bench re-exports it today (correction 3); its implementation-package ban keeps guarding bench `src/`                                                    |
| `package.json`                                                                                                              | delete                                              | the package ends; `test/bench` and `test/e2e` drop the `workspace:^` edge                                                                               |
| `stryker.config.ts`, `vitest.mutation.config.ts`                                                                            | delete                                              | R7                                                                                                                                                      |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.build.json`, `tsconfig.node.json`, `tsconfig.test.json`, `tsdown.config.ts` | delete                                              | the package ends; no build output is consumed; `test/e2e/tsconfig.test.json:21` and `test/bench/tsconfig.node.json:11` references go                    |
| `vitest.config.ts`                                                                                                          | folded into the receiving lanes' new vitest configs | in-source schema laws (`inSourceSchemaLaws()`) must keep running on the moved `*.schema.ts`, with its 180 s `testTimeout` for the generated report laws |

## Files outside the package that name it

`git grep -l e2e-core origin/main` at `381b3f5b1`, with the Done grep's exclusions and the package itself left out, lists 28 files. Each changes in the layer named:

- PR A: `.github/workflows/mutation.yml`, `.github/workflows/kill-matrix.yml`, `packages/stryker-js/tests/lockfile-closure-digest.integration.test.ts`.
- PR B: `test/bench/oxlint.config.ts`, `test/bench/tsconfig.node.json`, and the bench sources that import moved bench modules (`test/bench/src/bench-failure.schema.ts`, `bench-target.schema.ts`, `main.ts`, `prepare-side.service.ts`, `prepared-side.ts`, `run-bench.service.ts`, `workload-digest.service.ts`) where their imports are bench modules.
- PR C: `test/e2e/tests/__fixtures__/machine-stream.fixture.ts`, `test/e2e/tests/__fixtures__/run-artifacts.fixture.ts`.
- PR D: `test/bench/package.json`, `test/bench/corpus.json` and the bench sources' remaining imports (the shared install modules, D1); `test/e2e/package.json`, `test/e2e/tsconfig.test.json`, `test/e2e/oxlint.config.ts`, `test/e2e/AGENTS.md`, `test/e2e/README.md`, `test/e2e/scripts/seed-status-fault.ts`, `test/e2e/src/Harness/fixture-cache.service.ts`, `test/e2e/src/Harness/harness-failure.schema.ts`, `test/e2e/tests/__fixtures__/annotation-oracle.fixture.ts`, `test/e2e/tests/__fixtures__/e2e-harness.fixture.ts`; the two `docs/solutions/` lessons.

Which bench source imports which moved module is [unverified] per file; B and D split them by the import map when each PR is cut.

## PR Cut (one stack on `main`, bottom first)

Stacked because B, C and D each edit `test/e2e-core/src/mod.ts`, and D needs A (OP13b). Each layer leaves `main` releasable.

### PR A: Mutation grades the product only

- A1. Drop `test/e2e-core` from `mutation.yml:36`, `:43`, `:64` and `:118`; from `kill-matrix.yml:9`, `:15` and `:82`; and from `MUTATED_PROJECTS` at `lockfile-closure-digest.integration.test.ts:29-34`, in one commit (corrections 1 and 4).
- Test scenarios:
  - the live-lockfile scenario of `lockfile-closure-digest.integration.test.ts` passes with three projects;
  - workflow syntax passes whatever check CI runs on `.github/workflows` [unverified which];
  - the first `main` Mutation run after merge plans shards only for the three product projects.
- Not here: the package's own `mutation` script and `stryker.config.ts`, which go with the package in D.

### PR B: bench code into `test/bench`

- B1. `git mv` the bench sources, their four property tests and `bench-decisions.integration.test.ts` (inventory). Imports become relative; `mod.ts` loses the bench lines.
- B2. `test/bench` gains a `test` script (`vitest run`) and a `vitest.config.ts` that keeps in-source schema laws. `test/bench/oxlint.config.ts` inlines the config instead of re-exporting it, and `test/bench/tsconfig.node.json:11` loses its reference (correction 3).
- Test scenarios:
  - the same law names pass under `pnpm --filter @systemfsoftware/stryker-bench test`;
  - `turbo query` lists a `test` task for the bench, which has none today (P5);
  - bench comparisons keep their verdicts, except the `test/e2e-core` entry, which reads `workload changed` because its file set shrinks (D2 replaces it in D);
  - bench `src/` still refuses an implementation-package import (shown on a scratch edit, then reverted).

### PR C: the stream decoder becomes contract code

- C1. Add `run-event-stream.schema.ts` to `stryker-js-cli-contract` (D5), exported from the `RunEvent` namespace. Regenerate `etc/stryker-js-cli-contract.api.md`. Add a minor changeset for `@systemfsoftware/stryker-js-cli-contract`.
- C2. `test/e2e/tests/__fixtures__/machine-stream.fixture.ts` decodes through it. Delete `decode-stream.workflow.ts`. `decodeReport` goes (inventory), and `run-artifacts.fixture.ts` decodes `Report.MutationTestResult` itself.
- Test scenarios: new laws, each able to fail on a plausible bug, since the workflow has none today (P10):
  - encoding any event array and decoding it gives the same events;
  - inserting blank or whitespace-only lines anywhere changes nothing;
  - replacing line k with a non-event refuses with number k (catches an off-by-one or 0-based numbering);
  - a trailing newline is accepted.
- Mutation: the contract package is not in `PROJECTS` (correction 2), so these laws are not graded until Stream K enrols it; the PR says so.

### PR D: the e2e harness into `test/e2e`, then delete the package

- D-1. `git mv` the remaining sources, laws, suites and fixtures (inventory); the three fixture schemas fold into their fixture files (D6). `test/e2e` gains `test` (D3) with an in-process vitest config, and the source-only `exports` map (D1). `test/bench` imports the two shared modules from it.
- D-2. Delete `test/e2e-core`: the workspace entry, the lockfile importer (`pnpm install`), `test/e2e/tsconfig.test.json:21`, and the lint message at `test/e2e/oxlint.config.ts:17` (correction 3). Re-point the bench corpus (D2). Update the live docs and E2E-1's wording (D3).
- Test scenarios:
  - every moved law and suite passes under the receiving lane's `test` with the same names;
  - the status-closure suite still fails on a registry journey whose file is missing (E2E-1's gate; shown on a scratch edit, then reverted);
  - the fixture-manifests scenario still refuses #306's escaped key;
  - the install-closure offline scenario still installs from the committed lock (#311);
  - `pnpm test` runs no container journey, since `test/e2e`'s `test` config excludes `tests/**`;
  - the e2e lane runs only on `main` pushes (P13), so the journeys' unchanged verdicts are shown by the first `main` e2e run after merge, unless the e2e workflow can be dispatched on the PR branch [unverified].
- DEL1: the Done grep returns nothing.

## Mutation and kill-matrix sequencing with Stream K

- K owns `mutation.yml` and `kill-matrix.yml`. Whichever of PR A and a K PR touching those lines lands second merges `main` in. This stream does not edit K's PRs.
- #289 (`mutation.yml`, stacked on #271) and #271 (`kill-matrix.yml`) touch the same lines' neighbourhood. They merge `main` after PR A.
- PR D must not merge before PR A: deleting the package while `mutation.yml:36` still names it breaks the next Mutation run, and the live-lockfile scenario breaks while `MUTATED_PROJECTS` still names it. The stack order enforces this.
- Moving code out of `test/e2e-core` removes it from mutation grading (R7). Moving the decoder into `stryker-js-cli-contract` does not re-add it (correction 2). No surviving-mutant ids are targeted, because no product code changes.

## Open-PR landing order

All of these merge `main` after the layer named; none is edited here. State read from the GitHub API at refresh time.

| PR         | Branch                                                                                        | Touches                                                                                                           | Lands after | What its owner does on merging `main`                                                                             |
| ---------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| #271       | `stryker/verdict-store`                                                                       | `kill-matrix.yml`, install-closure sources and suite                                                              | A, D        | keep its kill-matrix line without `test/e2e-core`; re-apply its install-closure change at `test/e2e/src/Harness/` |
| #289       | `stryker/verdict-store-ci` (on #271)                                                          | `mutation.yml`                                                                                                    | A           | resolve `PROJECTS` without `test/e2e-core`                                                                        |
| #298       | `stryker/agent-surfaces-u3`                                                                   | bench run law, bench-decisions suite                                                                              | B           | re-apply in `test/bench`                                                                                          |
| #299       | `fix/gate-merged-break`                                                                       | `test/e2e-core/stryker.config.ts`                                                                                 | A, D        | drop the hunk: the file is gone and the project is no longer mutated                                              |
| #305       | `stryker/mutant-quality-l6-concurrency-default`                                               | annotated fixtures, placement and concurrency suites                                                              | D           | re-apply under `test/e2e/in-process/`                                                                             |
| #310       | `changeset-release/main`                                                                      | the package's `CHANGELOG.md`, `package.json`                                                                      | D           | the changesets bot regenerates the release PR                                                                     |
| #316       | `stryker/bench-off-pr`                                                                        | bench sources and laws                                                                                            | B           | place its bench workflows in `test/bench/src`                                                                     |
| #319       | `turbo/u1-task-inputs`                                                                        | adds `test/e2e-core/turbo.json`                                                                                   | D           | declare those inputs on `test/e2e` / `test/bench`                                                                 |
| #322       | `stream-a/cell-layer-adapters`                                                                | concurrency and placement suites                                                                                  | D           | re-apply under `test/e2e/in-process/`                                                                             |
| #326       | `turbo/u11-boundaries-diagnostics`                                                            | effect-concurrency fixtures                                                                                       | D           | re-apply under `test/e2e/in-process/__fixtures__/`                                                                |
| #287       | `stryker/mutant-quality-l2-diff-plan`                                                         | `test/e2e/tests/__fixtures__/annotation-oracle.fixture.ts`, `e2e-harness.fixture.ts`, plus files D does not touch | D           | re-apply its edits to the two fixtures whose package import D rewrites                                            |
| #296, #304 | `stryker/mutant-quality-l4-uncovered-block`, `stryker/mutant-quality-l5-equivalence-refusals` | `test/e2e/tests/failing-run.e2e.test.ts`                                                                          | none        | no overlap: that file does not name the package                                                                   |

#321 (Stream A) has merged, so its `MUTATED_PROJECTS` line is on `main` and PR A edits it directly.

## Packs (`.compound-engineering/config.yaml:1-4`)

`origin/main` at `381b3f5b1` enrols three packs: `compound-packs/cell-architecture`, `boundary-testing` and `schema-laws` from `systemfsoftware/systemfsoftware`. Every rule file named below exists in the local clone of that repo (`763fd663`, 2026-10-12). Only `tests-own-no-schemas` was re-read in full for this refresh; the other rules' text is cited from earlier sessions [unverified against `763fd663`].

- cell-architecture `single-namespace-barrel`: `test/e2e-core/src/mod.ts` re-exports unrelated leaves, which is not one capability. It is deleted, and no barrel is added for test tooling.
- cell-architecture `pure-decision-workflows`: every moved workflow keeps its laws beside it (`src/__tests__/<stem>.workflow.property.test.ts`). D5 replaces a workflow with a schema codec in the contract.
- schema-laws in-source laws: moved `src/*.schema.ts` keep their in-source law blocks, and each receiving vitest config enables `inSourceSchemaLaws()` with `includeSource` over `src`, as `test/e2e-core/vitest.config.ts` does today. C1's codec gets generated laws from the contract's existing config (P11) plus the four hand laws.
- schema-laws `tests-own-no-schemas` (re-read): it applies when "adding a `*.schema.ts` under `tests/`" (`:5`), and rule 3 (`:17`) puts harness schemas "in the harness file that uses them (`*.model.ts`, `*.fixture.ts`, or a fixture `*.workflow.ts` under `tests/`), never in a `*.schema.ts`". D6 decides what PR D does with the three `tests/__fixtures__/*.schema.ts`.
- boundary-testing `no-mocks-on-internal-glue`: the deleted law `∀t_…RefusedNamingTheFile` checks only a field copy. `real-system-oracles`: the install-closure and placement suites keep running against real npm (offline) and the real instrumenter.

## Load-bearing premises

- P1. Only `test/bench/package.json` and `test/e2e/package.json` declare the package (`git grep -l @systemfsoftware/stryker-e2e-core origin/main -- '*package.json'` at `381b3f5b1`). No `packages/*/src` file names it; the product test names the project as data (correction 1).
- P2. Mutation enrolment is at `mutation.yml:36`, `:43`, `:64` and `:118`, and at `kill-matrix.yml:9`, `:15` and `:82`. Source: `git grep -n e2e-core origin/main -- .github/workflows/` at `381b3f5b1`.
- P3. Commitlint has no scope list: `scope-enum` is `[0]` (`commitlint.config.ts:98`, `origin/main` at `381b3f5b1`). The `e2e-core` scope exists only in commit messages such as #306's `fix(e2e-core)`.
- P4. Contract packages are not mutation-graded: `PROJECTS` (`mutation.yml:36`) lists only the three product packages and `test/e2e-core`. Source: same grep as P2.
- P5. Neither receiving lane has a `test` task today: bench has `bench`, `lint`, `lint:tsgo` and `typecheck`; e2e has `fixtures:lock`, `lint`, `seed-status-fault`, `test:e2e` and `typecheck` (`scripts` in each `package.json`, `origin/main` at `381b3f5b1`; the package itself has `build`, `clean`, `lint`, `lint:tsgo`, `mutation`, `test` and `typecheck`). Adding `test` changes `check:ci`'s task scope, so each layer's PR cites `turbo query` affected tasks.
- P6. Shared by both lanes: `catalog-resolution.ts` and `install-closure.{schema,workflow}.ts` (import map over consumer files, earlier session) [unverified on today's `main`].
- P7. The bench benchmarks this package: `test/bench/corpus.json:14` (`origin/main` at `381b3f5b1`).
- P8. Lint and tsconfig coupling: `test/bench/oxlint.config.ts:1`, `test/bench/tsconfig.node.json:11`, `test/e2e/tsconfig.test.json:21`, `test/e2e/oxlint.config.ts:17` and `test/e2e/AGENTS.md:21` name the package (`origin/main` at `381b3f5b1`).
- P9. `MUTATED_PROJECTS` is at `packages/stryker-js/tests/lockfile-closure-digest.integration.test.ts:29-34` and is read at `:121-123` (`origin/main` at `381b3f5b1`).
- P10. `decode-stream.workflow.ts` has no property test: `src/__tests__` holds 13 laws and none is `decode-stream` (`git ls-tree`, `381b3f5b1`).
- P11. `stryker-js-cli-contract` has `test: vitest run`, no `src/__tests__`, dependencies `@systemfsoftware/stryker-js-plugin-interface` and `effect` only, and a vitest config with `inSourceSchemaLaws()` and `includeSource: ['src/**/*.ts']` (`origin/main` at `381b3f5b1`). So C1's codec gets generated laws without config changes, and its hand laws go in `src/__tests__` or `tests/` (both included).
- P12. `ManifestDocument` is declared at `src/catalog-resolution.schema.ts:67` (`origin/main` at `381b3f5b1`), and the package's vitest config runs `inSourceSchemaLaws()`, so `∀x_ManifestDocument_=x` is that schema's generated law [inference from the law name; the flake report is the root's, 2026-10-11]. It moves unchanged. Proposed owner of the fix: a separate Stream D unit after PR D, opened as an issue when D lands.
- P13. E2e journeys run only on `main` pushes (root, r41). Whether the e2e workflow accepts `workflow_dispatch` on a branch is [unverified].
- P14. E2E-1 and its gate are at `test/e2e/AGENTS.md:19`, naming `test/e2e-core/tests/status-closure.integration.test.ts` (`origin/main` at `381b3f5b1`).
- P15. Open PRs and their files: the landing table, from the GitHub API at refresh time. #321 is merged; #312 is closed.
