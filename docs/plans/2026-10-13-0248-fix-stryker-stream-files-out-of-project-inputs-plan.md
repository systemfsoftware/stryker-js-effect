---
title: No stream file Stryker writes enters the next run's inputs - Plan
type: fix
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-13-0216-fix-stryker-stream-files-out-of-project-inputs-plan.md
---

# No stream file Stryker writes enters the next run's inputs - Plan

## Goal Capsule

- **Objective:** a project re-run through the `stryker` CLI with nothing changed reuses every verdict, whatever its `ignorePatterns` (including `[]`) and whichever `stryker` commands ran in it before. A `progressStreamFile` set in the config file is where `stryker run` writes its stream.
- **Authority:** `CONSTITUTION.md`, then root `AGENTS.md`, then this plan. Stream J owns the CLI surface. This PR lands before PR #320 (the `--ignorePatterns` help text), which waits on it.
- **Supersedes:** the 0216 plan, which superseded the 0107 plan. 0107 was executed in `65953faa` and 0216 in `3cb10de5`; each review showed the outcome was not yet met, so this plan carries the corrected contract and the earlier files are removed in the same PR (REPO-D2).
- **Citations:** line numbers name `main` at `ec1769de`, the base this branch was cut from.
- **Open blockers:** none. OQ1 and OQ2 go to the root and OQ3 to PR #320; none gates this unit.

---

## Product Contract

### Summary

Every `stryker` command opens the event stream, and writes it to the `--progressStreamFile` flag's path or to `reports/mutation-stream.jsonl`. `stryker run` never reads `progressStreamFile` from the config file for this. The engine leaves only the resolved `progressStreamFile` out of a project's inputs. So with a configured path, the stream any command writes lands in an included file whose fresh `runId` changes the project, and the next run re-runs every mutant. The fix sends `stryker run`'s stream to the configured path and always leaves the default stream path out of the inputs.

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
- R7. A configured or flagged output path is left out of the inputs however it is spelled (`out/stream.jsonl`, `./out/stream.jsonl`, `out//stream.jsonl`).

### Acceptance Examples

- AE1. Covers R1, R3. A project whose config sets `progressStreamFile: 'out/stream.jsonl'`, `ignorePatterns: []` and a JSON report at `out/report.json` is run twice with `stryker run --json`. After the second run, `out/stream.jsonl` holds a `reuse` record with `ran: 0` and `reused` equal to the mutants in `out/report.json`, and `reports/mutation-stream.jsonl` does not exist.
- AE2. Covers R5. The same project is run, then asked for `stryker --help --json`, then run again. `reports/mutation-stream.jsonl` exists after the help, and the last run's `reuse` record in `out/stream.jsonl` has `ran: 0` and `reused` equal to the mutants in `out/report.json`.
- AE3. Covers R7. AE1 with `progressStreamFile: './out/stream.jsonl'` holds the same way.

### Scope Boundaries

- The ignore rules users write, `ALWAYS_IGNORE` and the digest are unchanged. The exclusion list gains the default stream path.
- Which commands write a stream is unchanged.
- The README sentences that state the stream always lands at `reports/mutation-stream.jsonl` (`README.md:303`, `:378`, `packages/stryker-js/README.md:200`) are corrected to name the configured `progressStreamFile`.
- No CI, Turbo, cache, workflow, fixture or timeout change. No mutation run of any kind.

### Key Decisions

- **`stryker run` resolves its stream path through the engine's own config resolution before the stream opens.** Covers R1, R2. `readConfig` (`packages/stryker-js/src/run/load-config.ts:99-121`) already runs in the CLI before the engine for `--survivors` and `--mutant` (`Survivors/Survivors.cell.ts:124`, `Rerun/Rerun.cell.ts:43`), needs only the file system and path services, and a second import of the config module hits Node's module cache (no cache-busting query, `run/read-config-document.ts:219-233`).
  - Rejected: excluding only the file the drain wrote. A configured `progressStreamFile` would stay ignored by the writer.
  - Rejected: holding the stream file until the engine reports its resolved options. That needs a new engine-to-drain channel through the event spine another workstream is refactoring.
  - Rejected: resolving the config for every command. It runs user config code for `--help`, `gate` and `compare`, and a failed read still writes the default file.
- **The default stream path is always left out of a project's inputs, next to the configured one.** Covers R5, and makes R4's fallback harmless. One constant in `stryker-outputs.ts` is both what the drain falls back to and what the exclusion list always holds, so the two cannot drift.
  - Rejected: exclusion only, without the `run` path fix. R1 would not hold.
- **The empty-path guard applies to the resolved value too.** Covers R6. The flag path already decoded `S.NonEmptyString` and fell back to the default (`run-request.cell.ts:132-136`); the same helper reads the resolved options.
- **The decision stays in `run-request.cell.ts`.** It has one outcome, a file name; `Workflow.make` refuses a single-variant decision and its error says to fold the function into its owning module (`@systemfsoftware/effect-cell-types` `SingleVariantDecision`, met on PR #320). CONST-W3 declaration: the route match and fallback are a branch the mutation config does not grade (`packages/stryker-js/stryker.config.ts:15-19`); AE1 and AE2 cover it through the built binary.

### Outstanding Questions

- OQ1 (for the root, outside this PR). `writeFileAtomic` (`packages/stryker-js/src/atomic-write.cell.ts:20-24`) asks for a temp file next to the target. Effect's `makeTempFile` creates a temp directory `<dir>/<prefix><hex>/` and the file inside it (`@effect/platform-node-shared` `NodeFileSystem.ts:428-437`); the rename moves the file out and leaves the empty directory, three per run. Empty directories do not reach the digest (variant E), but they pile up. Should a separate unit remove them?
- OQ2 (for the root, outside this PR). A non-`run` command given a non-default `--progressStreamFile` writes a stream the next plain `stryker run` does not exclude, and a stream left at a previously configured path stays an input after the config moves it. Should non-`run` commands stop writing a stream file?
- OQ3 (for PR #320, after this lands). #320 rebuilds `strykerOutputFilesOf` from option names for its help text and says "Other files under `reports/` are not ignored". After merging `main` it must keep `DEFAULT_PROGRESS_STREAM_FILE` in the list and name it in the help.

### Sources

- The variant tables above were run with `packages/stryker-js/dist/main.mjs` built from `ec1769de` and from `65953faa`, in throwaway projects under `/tmp`, deleted afterwards.
- Prior learning restored here: `docs/solutions/tooling-decisions/verdict-cache-content-keyed-reuse.md` ("a run never feeds its own inputs"; `strykerOutputFilesOf` is the one list).
- Same defect class upstream: [vercel/turborepo#7784](https://github.com/vercel/turborepo/issues/7784), [vercel/turborepo#7480](https://github.com/vercel/turborepo/discussions/7480).

---

## Planning Contract

### Key Technical Decisions

- KTD1. `stryker-outputs.ts` owns `DEFAULT_PROGRESS_STREAM_FILE`. `RunEventDrain` imports it for its initial path and keeps its published `DefaultProgressStreamFile` static on it. `strykerOutputFilesOf` returns it next to `options.progressStreamFile`.
- KTD4. `projectRelativeRuleOf` (`packages/stryker-js/src/read-project.cell.ts:110-114`) turns every Stryker-output entry into the project-relative path of `resolve(basePath, entry)`, the same normalization the drain and the reporters apply to the paths they write. Before, a relative entry reached the glob compiler verbatim, so `./out/stream.jsonl` or `out//stream.jsonl` never matched the crawled `out/stream.jsonl`. An entry outside the project keeps its old form, as absolute entries did.
- KTD2. `readRunRequest` resolves the stream file with `streamFileNameOf`. For route tag `run` it maps `readConfig(...)`'s resolved options through `progressStreamFileName`, the existing non-empty-or-default helper; on any `ConfigReadError` it applies the same helper to the command-line options. Other routes use the command-line options, as today.
- KTD3. The test drives the built `stryker` binary. `test-layer-selection` refuses process spawning in an integration test; the root's rule for this unit requires the built CLI, and both defects live only in the CLI's request read, which `Engine.strykerCell` and `./promises` `run()` never call. Siblings do the same (`tests/rerun-by-id.integration.test.ts`, `tests/plan-stream-location.integration.test.ts`).

### Assumptions This Breaks

- "The config file is read once per `stryker run`." It is now read twice, as `--survivors` and `--mutant` already do. The module is evaluated once; a config whose default export is a function is called twice, and a shadowed legacy config warns twice.
- "The stream header is written before any config work." The first `stdout` line now waits for the config import. A config import that hangs now hangs before the header instead of after it.
- "Only the configured stream path is excluded." The default path is excluded too; a project file of its own at `reports/mutation-stream.jsonl` is no longer an input and is not copied into the sandbox.
- "An output entry is matched as written." Output entries are now normalized before matching; a relative output name that relied on glob syntax (none of Stryker's do) is now matched as a path.

### Implementation Units

#### U1. Behaviour test, failing first

- **Goal:** AE1, AE2.
- **Files:** `packages/stryker-js/tests/progress-stream-file.integration.test.ts`.
- **Test scenarios:** one feature, two scenarios over a real temporary project with `ignorePatterns: []`, `progressStreamFile: 'out/stream.jsonl'` and a JSON report at `out/report.json`, driven through `dist/main.mjs`. Scenario 1: `run`, `run`. Scenario 2: `run`, `--help`, `run`. The `Then` steps read only `out/stream.jsonl`, `out/report.json` and whether `reports/mutation-stream.jsonl` exists.
- **Verification:** both scenarios fail against `main`'s binary. Scenario 2 also fails against the binary that has only the `run` path fix. No production source is edited to stage a failure.

#### U2. Resolve the run stream path through the config

- **Goal:** R1, R2, R4, R6.
- **Files:** `packages/stryker-js/src/run-request.cell.ts`.

#### U3. Always leave the default stream path out of the inputs

- **Goal:** R5.
- **Files:** `packages/stryker-js/src/stryker-outputs.ts`, `packages/stryker-js/src/run-event-stream.service.ts`.

#### U5. Match each output however its path is spelled

- **Goal:** R7, AE3.
- **Files:** `packages/stryker-js/src/read-project.cell.ts`.

#### U4. Docs and changeset

- **Files:** `README.md`, `packages/stryker-js/README.md`, a patch changeset for `@systemfsoftware/stryker-js`.

### Review Dispositions (report-only review of `65953faa`)

| Finding                                                                                   | Lens                     | Disposition                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Other commands still write the default stream, unexcluded                                 | correctness, adversarial | Fixed: U3, proven by AE2                                                                                                                                                                                             |
| A failed or disagreeing first config read sends the stream to an unexcluded path          | adversarial              | Fixed: the fallback path is the always-excluded default (U3). A config factory returning different paths per call is left as residual risk                                                                           |
| Empty `progressStreamFile` makes the drain open the project directory and drop all output | correctness, adversarial | Fixed: R6, U2                                                                                                                                                                                                        |
| READMEs state the default path unconditionally                                            | learnings                | Fixed: U4                                                                                                                                                                                                            |
| Prior repo learning not cited                                                             | learnings                | Fixed: Sources                                                                                                                                                                                                       |
| Changeset explains the mechanism                                                          | project-standards        | Fixed: U4                                                                                                                                                                                                            |
| Route decision lives in a cell the mutator does not grade                                 | project-standards        | Declared CONST-W3 exception (Key Decisions)                                                                                                                                                                          |
| Config module evaluated twice; duplicate legacy warning                                   | correctness, adversarial | Accepted; already true for `--survivors` and `--mutant`; listed in Assumptions                                                                                                                                       |
| Header waits on the config import                                                         | adversarial              | Accepted; listed in Assumptions                                                                                                                                                                                      |
| `--survivors`, `--mutant` and shard parents move their stream too                         | adversarial              | Intended: they are `run` invocations whose engine excludes the configured path                                                                                                                                       |
| R4 fallback has no committed test                                                         | testing                  | Smoke: a throwing config, a missing `--configFile` and an invalid option give the same exit code, error record and stream location on `main` and the branch. Not admitted as a test: it pins behaviour this PR keeps |
| R2 precedence asserted nowhere                                                            | testing                  | Owned by `readConfig`'s merge (`run/read-config-document.ts`); this PR only reads its result                                                                                                                         |
| Test takes the first `reuse` record                                                       | testing                  | Rejected: `ReuseReported` is emitted only in `settleMutants` (`run/mutant-settlement.ts:320-330`), reached once per run                                                                                              |
| Test does not cover module caching or double factory calls                                | testing                  | Rejected: assumptions, not behaviour this PR promises                                                                                                                                                                |
| Stream gates that clear the default path                                                  | learnings                | No in-repo consumer hardcodes it (`.github/`, `scripts/`); the changeset tells consumers to read the configured path                                                                                                 |
| Atomic-write temp directories                                                             | learnings                | OQ1                                                                                                                                                                                                                  |
| 18.0.0 changelog: relative stream path resolved against the working directory             | learnings                | Preserved; no action                                                                                                                                                                                                 |

Round 2, report-only review of `3cb10de5`:

| Finding                                                                                                  | Lens                     | Disposition                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| A `./`-prefixed or doubled-slash `progressStreamFile` is written but never matched by the exclusion rule | correctness, adversarial | Fixed: U5, proven by AE3; reproduced first on the built binary (reused 0, ran 2) |
| Scenario 2 never asserts the help left a default-path stream                                             | correctness, adversarial | Fixed: AE2 asserts it                                                            |
| `RunEventDrain.DefaultProgressStreamFile` removed from a published class                                 | correctness              | Fixed: kept, on the shared constant                                              |
| #320 rebuilds the list without the default path and its help says `reports/` is not ignored              | adversarial              | OQ3: #320 adapts after this lands, per the root's ordering                       |
| A project's own file at `reports/mutation-stream.jsonl` is no longer an input or copied to the sandbox   | adversarial, correctness | Accepted: listed in Assumptions                                                  |
| A stream left at a previously configured path stays an input                                             | correctness              | OQ2                                                                              |
| Relative rules use `/` and would not match on Windows                                                    | correctness              | Pre-existing for every output; CI is Linux-only; no action                       |

### Verification Contract

| Check          | Command                                                                                                                                                                                | Pass                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Failing before | U1 against `main`'s built binary; scenario 2 against `65953faa`'s                                                                                                                      | fails as U1 states                                     |
| Behaviour      | `vitest run tests/progress-stream-file.integration.test.ts` after building `dist`                                                                                                      | passes                                                 |
| Neighbours     | `vitest run tests/plan-stream-location.integration.test.ts tests/rerun-by-id.integration.test.ts tests/incremental-reuse.integration.test.ts tests/clean-temp-dir.integration.test.ts` | pass                                                   |
| Empty path     | a throwaway CLI run with `progressStreamFile: ''`                                                                                                                                      | stream at the default path, records on `stdout`        |
| Types and lint | `tsc -b`, `pnpm run lint:tsgo`, oxlint on the touched files, `dprint check`                                                                                                            | clean                                                  |
| Changeset      | the `author-changesets` validator                                                                                                                                                      | OK                                                     |
| Review         | `ce-code-review`, report-only                                                                                                                                                          | every finding has a disposition                        |
| CI             | `xd://github run_watch` on the PR head                                                                                                                                                 | every required check green; Bench reported, not chased |

No mutation run, local or dispatched: mutation evidence for this change comes from the next nightly on `main`.

## Definition of Done

- U1-U5 have landed in one PR off `main`, and every Verification Contract row holds on its head.
- The PR body carries the failing-first evidence, the review lenses, the models that actually served them, and OQ1-OQ3.
