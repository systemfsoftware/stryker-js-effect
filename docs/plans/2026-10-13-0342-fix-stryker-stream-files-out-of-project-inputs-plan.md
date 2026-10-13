---
title: No stream file Stryker writes enters the next run's inputs - Plan
type: fix
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-13-0337-fix-stryker-stream-files-out-of-project-inputs-plan.md
---

# No stream file Stryker writes enters the next run's inputs - Plan

## Goal Capsule

- **Objective:** a project re-run through the `stryker` CLI with nothing changed reuses every verdict, whatever its `ignorePatterns` (including `[]`) and whichever `stryker` commands ran in it before. A `progressStreamFile` set in the config file is where `stryker run` writes its stream.
- **Authority:** `CONSTITUTION.md`, then root `AGENTS.md`, then this plan. Stream J owns the CLI surface. This PR (#329) lands before PR #320 (the `--ignorePatterns` help text), which waits on it.
- **Supersedes:** the 0337 plan (never committed; its destructive review added the stateful-config consequence, OQ5 and the R4 smoke row), which superseded 0248, 0216 and 0107. 0107 was executed in `65953faa`, 0216 in `3cb10de5`, 0248 in `46abe7d2` (merged with `main` as `80f3959a`); each review showed the outcome was not yet met, so this plan carries the corrected contract and the earlier files are removed in the same PR (REPO-D2).
- **Citations:** line numbers name `main` at `ec1769de`, the base this branch was cut from, unless they name a file this PR changes.
- **Open blockers:** none. OQ1, OQ2, OQ4 and OQ5 go to the root and OQ3 to PR #320; none gates this unit.

---

## Product Contract

### Summary

Every `stryker` command opens the event stream, and writes it to the `--progressStreamFile` flag's path or to `reports/mutation-stream.jsonl`. `stryker run` never reads `progressStreamFile` from the config file for this. The engine leaves only the resolved `progressStreamFile` out of a project's inputs. So with a configured path, the stream any command writes lands in an included file whose fresh `runId` changes the project, and the next run re-runs every mutant. The fix sends `stryker run`'s stream to the configured path, hands the engine that same path, always leaves the default stream path out of the inputs, and matches each output however its path is spelled.

### Problem Frame

Measured through the built CLI on `ec1769de`, two runs of a real temporary project with nothing changed in between (`ignorePatterns: []`, `testRunner: 'command'`):

| Variant                                                  | Second run                          |
| -------------------------------------------------------- | ----------------------------------- |
| A. `progressStreamFile: 'out/stream.jsonl'` in config    | reused 0, ran 2, `closureChanged` 2 |
| B. A plus `--progressStreamFile out/stream.jsonl`        | reused 2, ran 0                     |
| C. no `progressStreamFile` (default path)                | reused 2, ran 0                     |
| D. A, default-path stream deleted between runs           | reused 0, ran 2                     |
| E. A, atomic-write temp directories deleted between runs | reused 0, ran 2                     |

Measured on the branch after fixing only `stryker run`'s path (commit `65953faa`), project as in A:

| Between the two runs                      | Next run        |
| ----------------------------------------- | --------------- |
| `stryker --help --json`                   | reused 0, ran 2 |
| `stryker gate --json`                     | reused 0, ran 2 |
| `stryker plan --target-seconds 60 --json` | reused 0, ran 2 |

Each of those commands writes `reports/mutation-stream.jsonl`.

Cause in code:

- `readRunRequest` opens the stream for every route, at the path named by `invocation.options`, the command-line options only (`packages/stryker-js/src/run-request.cell.ts:132-149`). The drain opens the file with flag `w` as the stream opens (`packages/stryker-js/src/run-event-stream.service.ts:162-181`, `:510-526`).
- The config file is read later, inside the engine (`packages/stryker-js/src/run/run-stages.cell.ts:23`). Its resolved `progressStreamFile` feeds the exclusion list (`packages/stryker-js/src/stryker-outputs.ts:8-21`, used at `read-project.cell.ts:122`), never the drain.
- `ALWAYS_IGNORE` (`read-project.cell.ts:33-41`) does not cover `reports/`.

### Requirements

- R1. When the `run` command's resolved configuration names `progressStreamFile`, the run writes its event stream at that path and writes no stream at `reports/mutation-stream.jsonl`.
- R2. The precedence stays as the engine applies it: a `--progressStreamFile` flag wins over the config file, and the config file wins over the default.
- R3. An unchanged project run twice through the CLI with `progressStreamFile` in its config and `ignorePatterns: []` re-runs no mutant on the second run.
- R4. A config file that cannot be read or is invalid is reported exactly as today. The stream still opens, at the flag or default path.
- R5. A stream file written at the default path by any `stryker` command never changes the next run's inputs.
- R6. An empty `progressStreamFile`, from the config or the flag, keeps today's behaviour: the stream goes to the default path.
- R7. A configured or flagged output path is left out of the inputs however it is spelled (`out/stream.jsonl`, `./out/stream.jsonl`, `out//stream.jsonl`, a trailing `/` kept, platform separators).
- R8. The path a run streams to is the path its own inputs leave out, even when a config function answers differently each time it is read.

### Acceptance Examples

All run the built `stryker` binary twice (or as stated) on a real temporary project with `ignorePatterns: []` and a JSON report at `out/report.json`, and read only the stream file, the report and whether `reports/mutation-stream.jsonl` exists.

- AE1. Covers R1, R3. Config sets `progressStreamFile: 'out/stream.jsonl'`. After the second run, `out/stream.jsonl` holds a `reuse` record with `ran: 0` and `reused` equal to the mutants in `out/report.json`, and `reports/mutation-stream.jsonl` does not exist.
- AE2. Covers R5. The same project is run, then asked for `stryker --help --json`, then run again. `reports/mutation-stream.jsonl` is absent after the first run and present after the help, and the last run reuses every reported mutant.
- AE3. Covers R7. AE1 with `./out/stream.jsonl` and with `out//stream.jsonl`.
- AE4. Covers R2. Config names `out/stream.jsonl`; both runs pass `--progressStreamFile out/flag.jsonl`. The second run's `reuse` record is in `out/flag.jsonl` and reuses every mutant; `out/stream.jsonl` is never written.
- AE5. Covers R8. The config's default export is a function answering `out/first.jsonl` on its first call and `out/later.jsonl` after. The second run's stream is in `out/first.jsonl` and reuses every mutant.
- AE6. Covers R6. Config sets `progressStreamFile: ''`. Both runs stream records on `stdout`; the second run's `reuse` record is in `reports/mutation-stream.jsonl` and reuses every mutant.
- AE7. Covers R4. A config that throws while loading: the run exits 2, its error record names `stryker.config.mjs`, and the stream is at `reports/mutation-stream.jsonl`.

### Scope Boundaries

- The ignore rules users write, `ALWAYS_IGNORE` and the digest are unchanged. The exclusion list gains the default stream path; its entries are normalized before matching.
- Which commands write a stream is unchanged.
- The README sentences that state the stream always lands at `reports/mutation-stream.jsonl` (`README.md:303`, `:378`, `packages/stryker-js/README.md:200`) and the learning at `docs/solutions/workflow-issues/mutation-lane-green-while-every-job-failed.md:31` are corrected to name the resolved `progressStreamFile`.
- No CI, Turbo, cache, workflow, e2e, fixture or timeout change. No mutation run of any kind.

### Key Decisions

- **`stryker run` resolves its stream path through the engine's own config resolution before the stream opens, and hands that path to the engine.** Covers R1, R2, R8. `readConfig` (`packages/stryker-js/src/run/load-config.ts:99-121`) already runs in the CLI before the engine for `--survivors` and `--mutant` (`Survivors/Survivors.cell.ts:124`, `Rerun/Rerun.cell.ts:43`). The resolved name is then set as the run's `progressStreamFile` option, which the engine's own read takes over the config file (command-line options win the merge), so the drain's path and the excluded path come from one answer.
  - Rejected: excluding only the file the drain wrote. A configured `progressStreamFile` would stay ignored by the writer.
  - Rejected: holding the stream file until the engine reports its resolved options. That needs a new engine-to-drain channel through the event spine another workstream is refactoring.
  - Rejected: resolving the config for every command. It runs user config code for `--help`, `gate` and `compare`, and a failed read still writes the default file.
  - Rejected: two independent reads (the 0248 design). A config function answering differently per call made the drain and the exclusion disagree (AE5 reproduced it: ran 2).
- **The default stream path is always left out of a project's inputs, next to the configured one.** Covers R5, and makes R4's fallback harmless. One constant in `stryker-outputs.ts` is what the drain falls back to and what the exclusion list always holds.
  - Rejected: exclusion only, without the `run` path fix. R1 would not hold.
- **The empty-path guard applies to the resolved value too.** Covers R6. The flag path already decoded `S.NonEmptyString` and fell back to the default (`run-request.cell.ts:132-136`); the same helper reads the resolved options.
- **Output entries are matched by their normalized project-relative path.** Covers R7. Each entry becomes the path of `resolve(basePath, entry)` relative to the project, joined with `/`, keeping a trailing `/`; an entry outside the project keeps its original form.
- **CONST-W3 declaration, waiving CONST-T4 ("Behavior Lives Where the Mutator Sees It") for two cases.** `packages/stryker-js/stryker.config.ts:15-19` mutates only `src/**/*.workflow.ts` and `src/**/*.schema.ts`, so two behaviours this PR adds go ungraded:
  1. the route match, config read and fallback that choose the run's stream path (`streamedRequestOf`, `packages/stryker-js/src/run-request.cell.ts`);
  2. the output-entry normalization (`slashedRuleOf`, `projectRelativeRuleOf`, `packages/stryker-js/src/read-project.cell.ts`).
     Both have one outcome, a path, and `Workflow.make` refuses a single-variant decision, telling the author to fold the function into its owning module (`@systemfsoftware/effect-cell-types` `SingleVariantDecision`, met on PR #320). AE1-AE7 grade both through the built binary instead.

### Outstanding Questions

- OQ1 (for the root, outside this PR). `writeFileAtomic` (`packages/stryker-js/src/atomic-write.cell.ts:20-24`) asks for a temp file next to the target. Effect's `makeTempFile` creates a temp directory `<dir>/<prefix><hex>/` and the file inside it (`@effect/platform-node-shared` `NodeFileSystem.ts:428-437`); the rename moves the file out and leaves the empty directory, three per run. Empty directories do not reach the digest (variant E), but they pile up. Should a separate unit remove them?
- OQ2 (for the root, outside this PR). A non-`run` command given a non-default `--progressStreamFile` writes a stream the next plain `stryker run` does not exclude, and a stream left at a previously configured path stays an input after the config moves it. Should non-`run` commands stop writing a stream file?
- OQ3 (for PR #320, after this lands). #320 rebuilds `strykerOutputFilesOf` from option names for its help text and says "Other files under `reports/` are not ignored". After merging `main` it must keep `DEFAULT_PROGRESS_STREAM_FILE` in the list and name it in the help.
- OQ4 (for the root, outside this PR). The default stream path is spelled in two packages: `DEFAULT_PROGRESS_STREAM_FILE` here and the option default in `packages/stryker-js-plugin-interface/src/stryker-options.schema.ts:252`. Should the plugin interface export it?
- OQ5 (for the root, outside this PR). A config whose default export is a function is now called twice per `stryker run`, so one that throws or changes state on a later call fails a run `main` completed (measured below). Should the config loader settle the export once per process and reuse that snapshot for every read, as `--survivors` and `--mutant` would also want?

### Sources

- The variant tables above were run with `packages/stryker-js/dist/main.mjs` built from `ec1769de` and from `65953faa`, in throwaway projects under `/tmp`, deleted afterwards.
- Prior learning restored here: `docs/solutions/tooling-decisions/verdict-cache-content-keyed-reuse.md` ("a run never feeds its own inputs"; `strykerOutputFilesOf` is the one list).
- Same defect class upstream: [vercel/turborepo#7784](https://github.com/vercel/turborepo/issues/7784), [vercel/turborepo#7480](https://github.com/vercel/turborepo/discussions/7480).

---

## Planning Contract

### Key Technical Decisions

- KTD1. `stryker-outputs.ts` owns `DEFAULT_PROGRESS_STREAM_FILE`. `RunEventDrain` imports it for its initial path and keeps its published `DefaultProgressStreamFile` static on it. `strykerOutputFilesOf` returns it next to `options.progressStreamFile`.
- KTD2. `readRunRequest` resolves a `StreamedRequest` with `streamedRequestOf`. For route tag `run` it maps `readConfig(...)`'s resolved options through `progressStreamFileName`, the non-empty-or-default helper; on any `ConfigReadError` it applies the same helper to the command-line options. Other routes use the command-line options and keep them unchanged.
- KTD3. The test drives the built `stryker` binary. `test-layer-selection` refuses process spawning in an integration test; the root's rule for this unit requires the built CLI, and the defects live only in the CLI's request read, which `Engine.strykerCell` and `./promises` `run()` never call. Siblings do the same (`tests/rerun-by-id.integration.test.ts`, `tests/plan-stream-location.integration.test.ts`).
- KTD4. `projectRelativeRuleOf` turns every Stryker-output entry into the project-relative path of `resolve(basePath, entry)`; `slashedRuleOf` joins it with `/` and keeps a trailing `/`. An entry outside the project keeps its old form, as absolute entries did.
- KTD5. For route tag `run`, the `CliRead` options carry `progressStreamFile` set to the resolved name, so every later config read in the run resolves the same path: the run stage, `--survivors` and `--mutant` all pass `channel.options` as `cliOptions` (`run-request.cell.ts:193`, `:216`, `:249`). The shard leaf spreads unpinned options (`:685`), but its children always pass `--progressStreamFile` (`shard/shard-run.ts:43-44`). `progressStreamFile` is one of the unfingerprinted `presentationOptionKeys` (`verdict-semantics.ts:99-111`), so reuse keys do not change.

### Assumptions This Breaks

- "The config file is read once per `stryker run`." It is now read twice, as `--survivors` and `--mutant` already do. The module is evaluated once; a config whose default export is a function is called twice, and a shadowed legacy config warns twice. The stream path comes from the first answer. Measured: a config function that throws on its second call completes on `main` (exit 0) and fails on the branch (exit 2, `Invalid config file`). OQ5.
- "The stream header is written before any config work." The first `stdout` line now waits for the config import. A config import that hangs now hangs before the header instead of after it.
- "Only the configured stream path is excluded." The default path is excluded too; a project file of its own at `reports/mutation-stream.jsonl` is no longer an input and is not copied into the sandbox.
- "An output entry is matched as written." Output entries are now normalized before matching; a relative output name that relied on glob syntax (none of Stryker's do) is now matched as a path.

### Implementation Units

#### U1. Behaviour test, failing first

- **Goal:** AE1-AE7.
- **Files:** `packages/stryker-js/tests/progress-stream-file.integration.test.ts`.
- **Test scenarios:** one feature. A Given prepares the project; When steps run the binary and read the files; a Then asserts. One outline (AE1, AE3) and five scenarios (AE2, AE4-AE7).
- **Verification:** each scenario failed first against a binary that lacked its fix: AE1 and AE2 on `main`, AE2 on `65953faa`, AE3 (`./` and `//`) on `3cb10de5`, AE5 on `80f3959a`, AE6 on `65953faa` (no records, no file). AE4 and AE7 pin behaviour `main` already had. No production source is edited to stage a failure.

#### U2. Resolve the run stream path through the config

- **Goal:** R1, R2, R4, R6.
- **Files:** `packages/stryker-js/src/run-request.cell.ts`.

#### U3. Always leave the default stream path out of the inputs

- **Goal:** R5.
- **Files:** `packages/stryker-js/src/stryker-outputs.ts`, `packages/stryker-js/src/run-event-stream.service.ts`.

#### U4. Docs and changeset

- **Files:** `README.md`, `packages/stryker-js/README.md`, `docs/solutions/workflow-issues/mutation-lane-green-while-every-job-failed.md`, a patch changeset for `@systemfsoftware/stryker-js`.

#### U5. Match each output however its path is spelled

- **Goal:** R7, AE3.
- **Files:** `packages/stryker-js/src/read-project.cell.ts`.

#### U6. The engine reads the stream path the drain opened

- **Goal:** R8, AE5.
- **Files:** `packages/stryker-js/src/run-request.cell.ts`.

### Review Dispositions

Round 1, report-only review of `65953faa`:

| Finding                                                                                   | Lens                     | Disposition                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Other commands still write the default stream, unexcluded                                 | correctness, adversarial | Fixed: U3, proven by AE2                                                                                             |
| A failed or disagreeing first config read sends the stream to an unexcluded path          | adversarial              | Fixed: the fallback path is the always-excluded default (U3); the disagreeing case is fixed in round 3 (U6, AE5)     |
| Empty `progressStreamFile` makes the drain open the project directory and drop all output | correctness, adversarial | Fixed: R6, U2, AE6                                                                                                   |
| READMEs state the default path unconditionally                                            | learnings                | Fixed: U4                                                                                                            |
| Prior repo learning not cited                                                             | learnings                | Fixed: Sources                                                                                                       |
| Changeset explains the mechanism                                                          | project-standards        | Fixed: U4                                                                                                            |
| Route decision lives in a cell the mutator does not grade                                 | project-standards        | Declared: CONST-W3 waiving CONST-T4 (Key Decisions)                                                                  |
| Config module evaluated twice; duplicate legacy warning                                   | correctness, adversarial | Accepted; already true for `--survivors` and `--mutant`; listed in Assumptions                                       |
| Header waits on the config import                                                         | adversarial              | Accepted; listed in Assumptions                                                                                      |
| `--survivors`, `--mutant` and shard parents move their stream too                         | adversarial              | Intended: they are `run` invocations whose engine excludes the same path                                             |
| R4 fallback has no committed test                                                         | testing                  | Fixed in round 3: AE7                                                                                                |
| R2 precedence asserted nowhere                                                            | testing                  | Fixed in round 3: AE4                                                                                                |
| Test takes the first `reuse` record                                                       | testing                  | Rejected: `ReuseReported` is emitted only in `settleMutants` (`run/mutant-settlement.ts:320-330`), once per run      |
| Test does not cover module caching or double factory calls                                | testing                  | Superseded: the double call's effect is now behaviour (R8) and AE5 covers it                                         |
| Stream gates that clear the default path                                                  | learnings                | No in-repo consumer hardcodes it (`.github/`, `scripts/`); the changeset tells consumers to read the configured path |
| Atomic-write temp directories                                                             | learnings                | OQ1                                                                                                                  |
| 18.0.0 changelog: relative stream path resolved against the working directory             | learnings                | Preserved; no action                                                                                                 |

Round 2, report-only review of `3cb10de5`:

| Finding                                                                                                  | Lens                     | Disposition                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| A `./`-prefixed or doubled-slash `progressStreamFile` is written but never matched by the exclusion rule | correctness, adversarial | Fixed: U5, proven by AE3; reproduced first on the built binary (reused 0, ran 2) |
| Scenario 2 never asserts the help left a default-path stream                                             | correctness, adversarial | Fixed: AE2 asserts it after each command                                         |
| `RunEventDrain.DefaultProgressStreamFile` removed from a published class                                 | correctness              | Fixed: kept, on the shared constant                                              |
| #320 rebuilds the list without the default path and its help says `reports/` is not ignored              | adversarial              | OQ3: #320 adapts after this lands, per the root's ordering                       |
| A project's own file at `reports/mutation-stream.jsonl` is no longer an input or copied to the sandbox   | adversarial, correctness | Accepted: listed in Assumptions; `packages/stryker-js/README.md:200` says so     |
| A stream left at a previously configured path stays an input                                             | correctness              | OQ2                                                                              |
| Relative rules use `/` and would not match on Windows                                                    | correctness              | Corrected in round 3: U5 introduced the gap and now joins with `/`               |

Round 3, full-path report-only review of `80f3959a`:

| Finding                                                                                   | Sev | Lens                  | Disposition                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CONST-W3 declaration never names the waived rule (CONST-T4), so it is not a legal waiver  | P0  | project-standards     | Fixed: Key Decisions names CONST-T4 and both cases                                                                                                                                            |
| A config function answering differently per read makes the drain and the exclusion differ | P1  | adversarial           | Fixed: U6, AE5; reproduced first on `80f3959a`'s binary (ran 2, reused 0)                                                                                                                     |
| Output normalization uses platform separators, so relative rules stop matching on Windows | P2  | cell-architecture     | Fixed: U5 joins with `/`. Not exercised: CI is Linux-only                                                                                                                                     |
| A project's own `reports/mutation-stream.jsonl` drops out of the inputs and the sandbox   | P2  | adversarial           | Accepted: Assumptions; `packages/stryker-js/README.md:200` says Stryker never counts that file                                                                                                |
| #320 can rebuild the output list without the default path                                 | P2  | adversarial           | OQ3; the root lands #329 first and #320 merges `main` after                                                                                                                                   |
| The run's stream moves to the configured path under a patch release                       | P2  | adversarial           | Kept patch: the config value was documented and ignored by the writer; the changeset tells readers the path; in-repo shard and merge readers pass explicit paths (`shard/shard-run.ts:43-44`) |
| R4's fallback has no test                                                                 | P2  | testing               | Fixed: AE7                                                                                                                                                                                    |
| R6's empty path has no test                                                               | P2  | testing               | Fixed: AE6                                                                                                                                                                                    |
| Header waits on the config import; the function is called once more                       | P3  | adversarial           | Accepted: Assumptions                                                                                                                                                                         |
| Normalization drops a trailing `/`                                                        | P3  | correctness           | Fixed: U5 keeps it                                                                                                                                                                            |
| Learning cited correctly                                                                  | P3  | learnings             | No action                                                                                                                                                                                     |
| `test/e2e/AGENTS.md:37` names the default stream path unconditionally                     | P3  | learnings             | Deferred to Stream K, which owns `test/e2e`; true for its fixtures, which set no `progressStreamFile`                                                                                         |
| `mutation-lane-green-while-every-job-failed.md:31` names the default path unconditionally | P3  | learnings             | Fixed: U4                                                                                                                                                                                     |
| The default-path exclusion narrows the digest without a test                              | P3  | learnings             | Accepted: as the P2 above                                                                                                                                                                     |
| Boundary suite proves only the acceptance pole (boundary-testing/real-system-oracles)     | P3  | boundary-testing pack | Fixed: AE7 is the refusal pole                                                                                                                                                                |
| The default stream path is spelled in two packages                                        | P3  | cell-architecture     | OQ4                                                                                                                                                                                           |
| `RunEventDrain.DefaultProgressStreamFile` is an unused published static                   | P3  | cell-architecture     | Kept: published on `main` and unchanged in value; removing it is a separate breaking API change                                                                                               |
| CONST-W3 declaration names only the run-request branch                                    | P3  | schema-laws pack      | Fixed: names the read-project normalization too                                                                                                                                               |
| `//` spelling has no test row                                                             | P3  | testing               | Fixed: AE3 outline row                                                                                                                                                                        |
| Flag-over-config has no end-to-end case                                                   | P3  | testing               | Fixed: AE4                                                                                                                                                                                    |
| Scenario 2 cannot attribute the default-path file to the help                             | P3  | testing               | Fixed: AE2 checks the file after each command                                                                                                                                                 |
| The binary runs sit in the Given; no When step                                            | P3  | testing               | Fixed: Given prepares, When runs and reads                                                                                                                                                    |

### Verification Contract

| Check           | Command                                                                                                                                                                                                                      | Pass                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Failing before  | U1's scenarios against the binaries named in U1                                                                                                                                                                              | fail as U1 states                                                                               |
| Behaviour       | `vitest run tests/progress-stream-file.integration.test.ts` after building `dist`                                                                                                                                            | passes                                                                                          |
| Neighbours      | `vitest run tests/plan-stream-location.integration.test.ts tests/rerun-by-id.integration.test.ts tests/incremental-reuse.integration.test.ts tests/clean-temp-dir.integration.test.ts tests/shard-merge.integration.test.ts` | pass                                                                                            |
| Config failures | a throwaway CLI run on `main`'s binary and the branch's: a config that throws, a missing `--configFile`, an invalid option, a function that throws on its second call                                                        | first three identical (exit, records, error, stream location); the fourth as Assumptions states |
| Types and lint  | `tsc -b`, `pnpm run lint:tsgo`, oxlint on the touched files, `dprint check`                                                                                                                                                  | clean                                                                                           |
| Changeset       | the `author-changesets` validator                                                                                                                                                                                            | OK                                                                                              |
| Review          | full-path `ce-code-review`, report-only, on the final head                                                                                                                                                                   | every finding has a disposition                                                                 |
| CI              | the PR head's check suites                                                                                                                                                                                                   | every required check green; Bench reported, not chased                                          |

No mutation run, local or dispatched: mutation evidence for this change comes from the next nightly on `main`.

## Definition of Done

- U1-U6 have landed in one PR off `main`, and every Verification Contract row holds on its head.
- The PR body carries the failing-first evidence, the review lenses, the models that actually served them, every pack ruling, and OQ1-OQ5.
