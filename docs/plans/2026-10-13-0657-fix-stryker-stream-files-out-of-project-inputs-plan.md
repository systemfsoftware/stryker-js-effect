---
title: No stream file Stryker writes enters the next run's inputs - Plan
type: fix
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-13-0641-fix-stryker-stream-files-out-of-project-inputs-plan.md
---

# No stream file Stryker writes enters the next run's inputs - Plan

## Goal Capsule

- **Objective:** a project re-run through the `stryker` CLI with nothing changed reuses every verdict, whatever its `ignorePatterns` (including `[]`) and whether `stryker run` or `stryker --help` ran in it before (shard outputs are OQ6). A `progressStreamFile` set in the config file is where `stryker run` writes its stream, and a stream file that cannot be opened or written never silences the run's `stdout` records.
- **Authority:** `CONSTITUTION.md`, then root `AGENTS.md`, then this plan. Stream J owns the CLI surface. This PR (#329) lands before PR #320 (the `--ignorePatterns` help text), which waits on it.
- **Supersedes:** the 0641 plan, executed in `2838944a`; its full review found no P0, P1 or P2, but R9 said a drain defect "is not recovered" when the backstop ignores it, R7 and the package README claimed any spelling where glob syntax still compiles as a glob, and the drain-level log name was a literal spelled twice. This plan carries the corrected contract and 0641 is removed in the same PR (REPO-D2). 0641 superseded 0601 (`54aeca2b`), 0547 (`014b542a`), 0527 (`751a12cc`, merged with `main` in `bfad43ca`), 0505 (`25a46beb`), 0453 (`7a3af040`), 0421 (`39c401e4`, `1059dc39`), 0409 (`bd72466b`), 0342 (`b6c0eb00`), 0337 (never committed), 0248 (`46abe7d2`), 0216 (`3cb10de5`) and 0107 (`65953faa`).
- **Citations:** line numbers name `main` at `ec1769de`, the base this branch was cut from, unless they name a file this PR changes.
- **Open blockers:** none. OQ1, OQ2, OQ4, OQ5, OQ6 and OQ7 go to the root and OQ3 to PR #320; none gates this unit.

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
- R4. A config file that cannot be read or is invalid, including an invalid `progressStreamFile`, is reported exactly as today. The stream still opens, at the flag or default path.
- R5. A stream file written at the default path by any `stryker` command never changes the next run's inputs.
- R6. An empty `progressStreamFile`, from the config or the flag, keeps today's behaviour: the stream goes to the default path.
- R7. A configured or flagged output path inside the project is left out of the inputs however its separators are spelled (`out/stream.jsonl`, `./out/stream.jsonl`, `out//stream.jsonl`, `out/stream.jsonl/`, nested) on every platform: the rule is the entry path the crawl gives that file. Containment is lexical: an absolute path counts only when it names the project through the path the crawl starts from. The rule compiles as an ignore glob, so a path holding glob syntax (`!`, `*`, `?`, `[`) keeps its glob meaning (OQ7); the package README tells users to keep those characters out.
- R8. The path a run streams to is the path its own inputs leave out, even when a config function answers differently each time it is read.
- R9. Under `--json`, a stream file that cannot be opened, or that refuses a write or a sync, from the config or the flag, is logged once as the drain's file failure (`stryker.output.drain_file_failed`) on `stderr`; the file gets no further lines and every record still reaches `stdout`, as `tee` keeps writing standard output when a file operand fails ([tee(1p)](https://www.man7.org/linux/man-pages/man1/tee.1p.html)). Only typed open, write and sync errors count. Anything else that ends the drain (a defect, an interruption, a failure closing the file) is logged as `stryker.output.drain_failed`, the name the plain drain already uses; the drain stops there, its remaining records are lost, and the run's exit code is unchanged, as on `main`. In human mode `stdout` never carried the records, so only the log applies.

### Acceptance Examples

All run the built `stryker` binary twice (or as stated) on a real temporary project with `ignorePatterns: []` and a JSON report at `out/report.json`, and read only the stream file, the report and whether `reports/mutation-stream.jsonl` exists.

- AE1. Covers R1, R3. Config sets `progressStreamFile: 'out/stream.jsonl'`. After the second run, `out/stream.jsonl` holds a `reuse` record with `ran: 0` and `reused` equal to the mutants in `out/report.json`, and `reports/mutation-stream.jsonl` does not exist.
- AE2. Covers R5. The same project is run, then asked for `stryker --help --json`, then run again. `reports/mutation-stream.jsonl` is absent after the first run and present after the help, and the last run reuses every reported mutant.
- AE3. Covers R7. AE1 with `./out/stream.jsonl`, `out//stream.jsonl`, `out/stream.jsonl/`, and `./out/nested/stream.jsonl` read at `out/nested/stream.jsonl`.
- AE4. Covers R2. Config names `out/stream.jsonl`; both runs pass `--progressStreamFile out/flag.jsonl`. The second run's `reuse` record is in `out/flag.jsonl` and reuses every mutant; `out/stream.jsonl` is never written.
- AE5. Covers R8. The config's default export is a function answering `out/first.jsonl` on its first call and `out/later.jsonl` after. The second run's stream is in `out/first.jsonl` and reuses every mutant.
- AE6. Covers R6. Config sets `progressStreamFile: ''`. Both runs stream records on `stdout`; the second run's `reuse` record is in `reports/mutation-stream.jsonl` and reuses every mutant.
- AE7. Covers R4. A config that throws while loading, and a config whose `progressStreamFile` is `null`: each run exits 2, its error record names `stryker.config.mjs` or `progressStreamFile` respectively, and the stream is at `reports/mutation-stream.jsonl`.
- AE8. Covers R9. Config sets `progressStreamFile: 'out/stream'`, an existing empty directory; and, separately, the flag names `/dev/full`, which opens and refuses every write (the row refuses to run where `/dev/full` is missing instead of degrading into an open failure). Each run exits 0, its `stdout` carries `mutantTested` records and ends with the verdict, and its `stderr` names `stryker.output.drain_file_failed` exactly once.

### Scope Boundaries

- The ignore rules users write, `ALWAYS_IGNORE` and the digest are unchanged. The exclusion list gains the default stream path; its entries are normalized before matching.
- Which commands write a stream is unchanged.
- The README sentences that stated the stream always lands at `reports/mutation-stream.jsonl` (`README.md:303`, `:378`, `packages/stryker-js/README.md:200`) and the learning at `docs/solutions/workflow-issues/mutation-lane-green-while-every-job-failed.md:31` name the resolved `progressStreamFile`, which the config file sets for `stryker run` only. The learning `docs/solutions/tooling-decisions/verdict-cache-content-keyed-reuse.md` states the matching rule and its lexical containment.
- No CI, Turbo, cache, workflow, e2e, fixture or timeout change. No mutation run of any kind.
- The changeset is `major` (package-topology `surface-changes-are-versioned`: consumers observe the change): a mutation run whose config names a non-empty `progressStreamFile` no longer streams to `reports/mutation-stream.jsonl`, a config function is called once more per run (stream path from its first answer, every other option from its second), a project's own `reports/mutation-stream.jsonl` leaves the project, and `RunEvent.RunEventDrain.DefaultProgressStreamFile` is removed (BREAK-1; the `Configuration.defaultOptions` effect yields the default). Each is listed under Breaking.

### Key Decisions

- **`stryker run` resolves its stream path through the engine's own config resolution before the stream opens, and hands that path to the engine.** Covers R1, R2, R8. `readConfig` (`packages/stryker-js/src/run/load-config.ts:99-121`) already runs in the CLI before the engine for `--survivors` and `--mutant` (`Survivors/Survivors.cell.ts:124`, `Rerun/Rerun.cell.ts:43`). The resolved name is then set as the run's `progressStreamFile` option, which the engine's own read takes over the config file (command-line options win the merge), so the drain's path and the excluded path come from one answer.
  - Rejected: excluding only the file the drain wrote. A configured `progressStreamFile` would stay ignored by the writer.
  - Rejected: holding the stream file until the engine reports its resolved options. That needs a new engine-to-drain channel through the event spine another workstream is refactoring.
  - Rejected: resolving the config for every command. It runs user config code for `--help`, `gate` and `compare`, and a failed read still writes the default file.
  - Rejected: two independent reads (the 0248 design). A config function answering differently per call made the drain and the exclusion disagree (AE5 reproduced it: ran 2).
- **The default stream path is always left out of a project's inputs, next to the configured one.** Covers R5, and makes R4's fallback harmless. One constant in `stryker-outputs.ts` is what the drain falls back to and what the exclusion list always holds.
  - Rejected: exclusion only, without the `run` path fix. R1 would not hold.
- **The empty-path guard applies to the resolved value too.** Covers R6. The flag path already decoded `S.NonEmptyString` and fell back to the default (`run-request.cell.ts:132-136`); the same helper reads the resolved options.
- **Output entries are matched by the entry path the crawl gives the file.** Covers R7. Each entry inside the project is resolved and named as the crawl names an entry: the parent directory's project-relative path, `/`, the file name. That holds for every spelling, depth and platform, including nested paths on Windows, which `main` missed. An entry outside the project keeps its original form. Containment is lexical; resolving symlinks would need file-system reads in the rule derivation for an absolute spelling through another root, which `main` did not handle either.
- **CONST-W3 declaration, waiving CONST-T4 ("Behavior Lives Where the Mutator Sees It") for three cases.** `packages/stryker-js/stryker.config.ts:15-19` mutates only `src/**/*.workflow.ts` and `src/**/*.schema.ts`, so three behaviours this PR adds go ungraded:
  1. the route match, config read and fallback that choose the run's stream path (`streamedRequestOf`, `flaggedRequestOf`, `pinnedRequestOf`, `packages/stryker-js/src/run-request.cell.ts`);
  2. the output-entry derivation (`isInsideProject`, `crawlEntryPathOf`, `projectRelativeRuleOf`, `packages/stryker-js/src/read-project.cell.ts`);
  3. the drain's fallback to `stdout` alone when the stream file cannot be opened or written (`drainToSinks`, `writeLineOf`, `logFileFailure`, `packages/stryker-js/src/run-event-stream.service.ts`).
     The first two have one outcome, a path, and `Workflow.make` refuses a single-variant decision, telling the author to fold the function into its owning module (`@systemfsoftware/effect-cell-types` `SingleVariantDecision`, met on PR #320). The third is I/O inside a service's sink, with no decision to extract. AE1-AE8 grade all three through the built binary instead.

### Outstanding Questions

- OQ1 (for the root, outside this PR). `writeFileAtomic` (`packages/stryker-js/src/atomic-write.cell.ts:20-24`) asks for a temp file next to the target. Effect's `makeTempFile` creates a temp directory `<dir>/<prefix><hex>/` and the file inside it (`@effect/platform-node-shared` `NodeFileSystem.ts:428-437`); the rename moves the file out and leaves the empty directory, three per run. Empty directories do not reach the digest (variant E), but they pile up. Should a separate unit remove them?
- OQ2 (for the root, outside this PR). A non-`run` command given a non-default `--progressStreamFile` writes a stream the next plain `stryker run` does not exclude, and a stream left at a previously configured path stays an input after the config moves it. Should non-`run` commands stop writing a stream file?
- OQ3 (for PR #320, after this lands). #320 rebuilds `strykerOutputFilesOf` from option names for its help text and says "Other files under `reports/` are not ignored". After merging `main` it must keep `DEFAULT_PROGRESS_STREAM_FILE` in the list and name it in the help.
- OQ4 (for the root, outside this PR). The default stream path is spelled in two packages: `DEFAULT_PROGRESS_STREAM_FILE` here and the option default in `packages/stryker-js-plugin-interface/src/stryker-options.schema.ts:252`. Should the plugin interface export it?
- OQ5 (for the root, outside this PR). A config whose default export is a function is now called twice per `stryker run`, so one that throws or changes state on a later call fails a run `main` completed (measured below), and a shadowed legacy config warns twice. A `--plan --shard` parent and each of its children are `run` invocations, so one sharded run evaluates the config once more per child (adversarial lens, round 12; not measured here). Should the config loader settle the export once per process and reuse that snapshot for every read, as `--survivors` and `--mutant` would also want?
- OQ6 (for the root, outside this PR). `stryker run --plan --shard` children stream to `<outDir>/<project>/mutation-stream.jsonl` (`packages/stryker-js/src/shard/shard-run.ts:34-48`), and `outDir` defaults to `<planDirectory>/reports/shards/<index>` under the base path (`:93-96`). When the plan's directory is a project's own root, a later plain run of that project includes the file and re-runs every mutant, as on `main` (adversarial lens, round 9; not measured here). A shard child whose stream file cannot be written also leaves the previous run's file in place, which `stryker merge` accepts when the mutant ids match (adversarial lens, round 10; as on `main`, where the child's file was not written either). Should shard outputs join `strykerOutputFilesOf`, should the default `outDir` leave the project, and should a shard child clear its stream file before it runs?
- OQ7 (for the root, outside this PR). Output entries are normalized, then compiled as ignore globs like every user pattern (`compileIgnoreRule` in `admit-discovered-entry.workflow.ts`), as on `main`. A configured path containing glob syntax keeps its glob meaning: `out/stream?.jsonl` also leaves out `out/stream1.jsonl`, and a leading `!` negates the rule (adversarial lens, round 12; not measured here). Should Stryker's own output entries be matched as literal paths?

### Sources

- The variant tables above were run with `packages/stryker-js/dist/main.mjs` built from `ec1769de` and from `65953faa`, in throwaway projects under `/tmp`, deleted afterwards.
- Prior learning restored here: `docs/solutions/tooling-decisions/verdict-cache-content-keyed-reuse.md` ("a run never feeds its own inputs"; `strykerOutputFilesOf` is the one list).
- Same defect class upstream: [vercel/turborepo#7784](https://github.com/vercel/turborepo/issues/7784), [vercel/turborepo#7480](https://github.com/vercel/turborepo/discussions/7480).

---

## Planning Contract

### Key Technical Decisions

- KTD1. `stryker-outputs.ts` owns `DEFAULT_PROGRESS_STREAM_FILE`. `RunEventDrain` imports it for its initial path; its published `DefaultProgressStreamFile` static is removed, one name per value (BREAK-1). `strykerOutputFilesOf` returns it next to `options.progressStreamFile`.
- KTD2. `readRunRequest` resolves a `StreamedRequest` with `streamedRequestOf`. For route tag `run` it maps `readConfig(...)`'s resolved options through `progressStreamFileName`, the non-empty-or-default helper, and pins the name into the run's options. On any `ConfigReadError` it pins nothing: the stream opens at the flag or default path and the engine's own read refuses the config as today. Other routes use the command-line options and keep them unchanged.
- KTD3. The test drives the built `stryker` binary. `test-layer-selection` refuses process spawning in an integration test; the root's rule for this unit requires the built CLI, and the defects live only in the CLI's request read, which `Engine.strykerCell` and `./promises` `run()` never call. Siblings do the same (`tests/rerun-by-id.integration.test.ts`, `tests/plan-stream-location.integration.test.ts`).
- KTD4. `projectRelativeRuleOf` resolves each Stryker-output entry against the project; when `isInsideProject` holds (non-empty, not `..` or a `..` segment, not absolute), `crawlEntryPathOf` names it as `crawlDirectory` names an entry (`directoryPrefixOf` of the parent's relative path, then the base name). Otherwise the entry keeps its spelling. A throwaway probe over `path.posix` and `path.win32` showed the rule equal to the crawl's entry path for every spelling, nested and absolute entries and a `..foo` directory, where `main` and `1059dc39` missed nested paths on win32.
- KTD5. For route tag `run`, the `CliRead` options carry `progressStreamFile` set to the resolved name, so every later config read in the run resolves the same path: the run stage, `--survivors`, `--mutant` and the shard leaf are all `run` invocations (`Cli.schema.ts` `RunRequestSchema`) and pass the pinned `channel.options` on (`run-request.cell.ts:193`, `:216`, `:249`, `:685`). `progressStreamFile` is one of the unfingerprinted `presentationOptionKeys` (`verdict-semantics.ts:99-111`), so reuse keys do not change.

### Assumptions This Breaks

- "The config file is read once per `stryker run`." It is now read twice, as `--survivors` and `--mutant` already do (they now read it three times). The module is evaluated once; a config whose default export is a function is called twice, and a shadowed legacy config warns twice. The stream path comes from the first answer, every other option from the second. Measured: a config function that throws on its second call completes on `main` (exit 0) and fails on the branch (exit 2, `Invalid config file`). OQ5.
- "The stream header is written before any config work." The first `stdout` line now waits for the config import. A config import that hangs now hangs before the header instead of after it.
- "A drain whose file fails stops the run's output." On `main`, `--progressStreamFile` naming a directory exited 0 with no `stdout` record at all, and naming `/dev/full` exited 0 with no record and no log. The drain now logs the first failure and still writes every record to `stdout`. The exit code stays 0, unlike `tee`'s non-zero status: the run's own outcome decides it, and the file failure is logged as `stryker.output.drain_file_failed`.
- "A failed write or sync can be retried." After the first failure the file gets no further lines, even if a later write would succeed. After a failed `fsync` the kernel may already have dropped the dirty pages and marked them clean, so a later sync can report success for data that never reached disk ([LWN, PostgreSQL's fsync() surprise](https://lwn.net/Articles/752063/)); a file whose contents are unknown is not extended. The file may end in a torn line; stream readers already skip undecodable lines.
- "Only the configured stream path is excluded." The default path is excluded too; a project file of its own at `reports/mutation-stream.jsonl` is no longer an input and is not copied into the sandbox.
- "An output entry is matched as written." Output entries are now named as the crawl names files before they compile as ignore globs. Glob syntax in an entry keeps its glob meaning, as on `main` (OQ7).

### Implementation Units

#### U1. Behaviour test, failing first

- **Goal:** AE1-AE8.
- **Files:** `packages/stryker-js/tests/progress-stream-file.integration.test.ts`.
- **Test scenarios:** one feature. A Given prepares the project; When steps run the binary and read the files; a Then asserts. One outline (AE1, AE3), one refusal outline (AE7), one file-failure outline (AE8) and four scenarios (AE2, AE4-AE6).
- **Verification:** each scenario failed first against a binary that lacked its fix: AE1 and AE2 on `main`, AE2 on `65953faa`, AE3 (`./` and `//`) on `3cb10de5`, AE3 (trailing `/`) and AE7 (invalid `progressStreamFile`, exit 0) on `b6c0eb00`, AE3 (nested `./`) on `main`, AE5 on `80f3959a`, AE6 on `65953faa` (no records, no file), AE8 (directory) on `25a46beb` (no `mutantTested`, no verdict), AE8 (`/dev/full`) on `bfad43ca` (no `mutantTested`, no verdict, no log). AE8's exactly-once count guards the latch `writeLineOf` holds and passes on this head; without the latch every later line would log again (reasoned from the code, not run: no failure is staged by editing source). AE4 and AE7's throwing config pin behaviour `main` already had. No production source is edited to stage a failure.

#### U2. Resolve the run stream path through the config

- **Goal:** R1, R2, R4, R6.
- **Files:** `packages/stryker-js/src/run-request.cell.ts`.

#### U3. Always leave the default stream path out of the inputs

- **Goal:** R5.
- **Files:** `packages/stryker-js/src/stryker-outputs.ts`, `packages/stryker-js/src/run-event-stream.service.ts`.

#### U4. Docs and changeset

- **Files:** `README.md`, `packages/stryker-js/README.md`, `docs/solutions/workflow-issues/mutation-lane-green-while-every-job-failed.md`, `docs/solutions/tooling-decisions/verdict-cache-content-keyed-reuse.md`, a `major` changeset for `@systemfsoftware/stryker-js`.

#### U5. Match each output however its path is spelled

- **Goal:** R7, AE3.
- **Files:** `packages/stryker-js/src/read-project.cell.ts`.

#### U6. The engine reads the stream path the drain opened

- **Goal:** R8, AE5.
- **Files:** `packages/stryker-js/src/run-request.cell.ts`.

#### U7. The drain writes `stdout` when its file cannot be opened or written

- **Goal:** R9, AE8.
- **Files:** `packages/stryker-js/src/run-event-stream.service.ts`.

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
| `RunEventDrain.DefaultProgressStreamFile` removed from a published class                                 | correctness              | Reversed in round 5: removed under BREAK-1, listed under Breaking                |
| #320 rebuilds the list without the default path and its help says `reports/` is not ignored              | adversarial              | OQ3: #320 adapts after this lands, per the root's ordering                       |
| A project's own file at `reports/mutation-stream.jsonl` is no longer an input or copied to the sandbox   | adversarial, correctness | Accepted: listed in Assumptions; `packages/stryker-js/README.md:200` says so     |
| A stream left at a previously configured path stays an input                                             | correctness              | OQ2                                                                              |
| Relative rules use `/` and would not match on Windows                                                    | correctness              | Corrected in round 3: U5 introduced the gap and now joins with `/`               |

Round 3, full-path report-only review of `80f3959a`:

| Finding                                                                                   | Sev | Lens                  | Disposition                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CONST-W3 declaration never names the waived rule (CONST-T4), so it is not a legal waiver  | P0  | project-standards     | Fixed: Key Decisions names CONST-T4 and both cases                                                                                                       |
| A config function answering differently per read makes the drain and the exclusion differ | P1  | adversarial           | Fixed: U6, AE5; reproduced first on `80f3959a`'s binary (ran 2, reused 0)                                                                                |
| Output normalization uses platform separators, so relative rules stop matching on Windows | P2  | cell-architecture     | Partly fixed, corrected in round 4: rules are `/`-joined; nested crawl paths keep the platform separator (pre-existing). Not exercised: CI is Linux-only |
| A project's own `reports/mutation-stream.jsonl` drops out of the inputs and the sandbox   | P2  | adversarial           | Accepted: Assumptions; `packages/stryker-js/README.md:200` says Stryker never counts that file                                                           |
| #320 can rebuild the output list without the default path                                 | P2  | adversarial           | OQ3; the root lands #329 first and #320 merges `main` after                                                                                              |
| The run's stream moves to the configured path under a patch release                       | P2  | adversarial           | Superseded in round 4: `major`, with a Breaking list                                                                                                     |
| R4's fallback has no test                                                                 | P2  | testing               | Fixed: AE7                                                                                                                                               |
| R6's empty path has no test                                                               | P2  | testing               | Fixed: AE6                                                                                                                                               |
| Header waits on the config import; the function is called once more                       | P3  | adversarial           | Accepted: Assumptions                                                                                                                                    |
| Normalization drops a trailing `/`                                                        | P3  | correctness           | Reversed in round 4: keeping it broke the trailing-`/` stream spelling (P1); the rule is now the path Stryker writes                                     |
| Learning cited correctly                                                                  | P3  | learnings             | No action                                                                                                                                                |
| `test/e2e/AGENTS.md:37` names the default stream path unconditionally                     | P3  | learnings             | Deferred to Stream K, which owns `test/e2e`; true for its fixtures, which set no `progressStreamFile`                                                    |
| `mutation-lane-green-while-every-job-failed.md:31` names the default path unconditionally | P3  | learnings             | Fixed: U4                                                                                                                                                |
| The default-path exclusion narrows the digest without a test                              | P3  | learnings             | Accepted: as the P2 above                                                                                                                                |
| Boundary suite proves only the acceptance pole (boundary-testing/real-system-oracles)     | P3  | boundary-testing pack | Fixed: AE7 is the refusal pole                                                                                                                           |
| The default stream path is spelled in two packages                                        | P3  | cell-architecture     | OQ4                                                                                                                                                      |
| `RunEventDrain.DefaultProgressStreamFile` is an unused published static                   | P3  | cell-architecture     | Reversed in round 5: removed under BREAK-1                                                                                                               |
| CONST-W3 declaration names only the run-request branch                                    | P3  | schema-laws pack      | Fixed: names the read-project normalization too                                                                                                          |
| `//` spelling has no test row                                                             | P3  | testing               | Fixed: AE3 outline row                                                                                                                                   |
| Flag-over-config has no end-to-end case                                                   | P3  | testing               | Fixed: AE4                                                                                                                                               |
| Scenario 2 cannot attribute the default-path file to the help                             | P3  | testing               | Fixed: AE2 checks the file after each command                                                                                                            |
| The binary runs sit in the Given; no When step                                            | P3  | testing               | Fixed: Given prepares, When runs and reads                                                                                                               |

Round 4, full-path report-only review of `b6c0eb00`:

| Finding                                                                                         | Sev | Lens                           | Disposition                                                                                                        |
| ----------------------------------------------------------------------------------------------- | --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `progressStreamFile: 'out/stream.jsonl/'` is written at `out/stream.jsonl` but never excluded   | P1  | correctness                    | Fixed: KTD4; AE3 row, failed first on `b6c0eb00` (ran 2)                                                           |
| A failed config read pins the fallback and masks an invalid configured `progressStreamFile`     | P1  | correctness                    | Fixed: KTD2; AE7 row, failed first on `b6c0eb00` (exit 0)                                                          |
| The config is evaluated once more per run; `--survivors` and `--mutant` evaluate it three times | P1  | adversarial                    | Accepted: OQ5; the changeset says "once more" and lists it under Breaking                                          |
| The patch bump hides consumer-observable changes                                                | P2  | adversarial, package-topology  | Fixed: `major` with a Breaking list (Scope Boundaries)                                                             |
| The stream header waits on the config import                                                    | P2  | adversarial                    | Accepted: Assumptions                                                                                              |
| A non-`run` command given a non-default `--progressStreamFile` leaves an unexcluded stream      | P2  | adversarial                    | OQ2                                                                                                                |
| A project's own `reports/mutation-stream.jsonl` leaves the project on every route               | P2  | adversarial                    | Accepted: Assumptions; listed under Breaking                                                                       |
| Windows fix is one-sided below the top level                                                    | P3  | adversarial, cell-architecture | Corrected the round-3 disposition and KTD4; pre-existing on `main`; CI is Linux-only                               |
| R6's empty flag has no scenario                                                                 | P3  | testing                        | Not admitted: the flag's empty guard is unchanged from `main` (`progressStreamFileName` decoded it before this PR) |
| Platform separators cannot be exercised on Linux CI                                             | P3  | testing                        | Accepted: as above                                                                                                 |
| AE6's stdout-records clause is incidental                                                       | P3  | testing                        | Rejected: it catches the `65953faa` regression, where an empty path left no stdout records and no stream file      |
| R4's missing `--configFile` and invalid option have no scenario                                 | P3  | testing                        | AE7 adds the invalid `progressStreamFile`; the other two are the Config failures smoke row (unchanged behaviour)   |
| `README.md:303` names only the flag                                                             | P3  | learnings                      | Fixed: names the config file                                                                                       |
| The changeset's "including those left by other commands" overstates (OQ2)                       | -   | learnings (residual)           | Fixed: removed                                                                                                     |
| `RunEventDrainLive` is an exported `*Live` (service-and-layer-boundaries)                       | -   | cell-architecture (residual)   | Pre-existing and untouched; no action                                                                              |

Round 5, full-path report-only review of `bd72466b` (findings: 0 P0, 0 P1, 4 P2, 7 P3):

| Finding                                                                                      | Sev | Lens                   | Disposition                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A config whose first read fails and second succeeds streams at the default path, and exits 0 | P2  | adversarial            | Accepted: the class of OQ5 (a config function that does not answer the same each time); the Breaking list requires the same answer each time; the default path is excluded, so reuse holds                                                                 |
| #320 ships a help sentence the always-excluded default makes false                           | P2  | adversarial            | OQ3; the root lands #329 first and #320 merges `main` after                                                                                                                                                                                                |
| U4 still asks for a patch changeset                                                          | P2  | learnings              | Fixed: U4 names `major`                                                                                                                                                                                                                                    |
| A duplicate published name kept for compatibility (BREAK-1)                                  | P2  | project-standards      | Fixed: static removed; listed under Breaking; `tsc -b` and `api-extractor` clean                                                                                                                                                                           |
| "However their paths are spelled" is false for nested outputs on Windows                     | P3  | adversarial, learnings | Fixed: the changeset names the spellings AE3 proves                                                                                                                                                                                                        |
| KTD5 calls the shard leaf unpinned                                                           | P3  | correctness            | Fixed: KTD5                                                                                                                                                                                                                                                |
| `README.md:378` still names only the default                                                 | P3  | correctness            | Fixed: names the flag and the config file                                                                                                                                                                                                                  |
| The owning learning lacks the matching rule                                                  | P3  | learnings              | Fixed: `verdict-cache-content-keyed-reuse.md` states it; the solution-doc validator passes                                                                                                                                                                 |
| AE7 is not a refusing endpoint (boundary-testing `real-system-oracles`)                      | P3  | boundary-testing pack  | Disputed, no change: the rule targets network, socket and watcher adapters; here the refusal pole is a refused config that exits 2 with an error record and never reports a verdict, and teardown is the scoped temp directory plus the awaited child exit |
| R7's flagged spelling has no row                                                             | P3  | testing                | Not admitted: flag and config values reach the drain and the exclusion through the same merged option, so a flag row repeats AE3's path                                                                                                                    |
| The extra config evaluation (`--survivors`, `--mutant` now three)                            | -   | adversarial (residual) | OQ5                                                                                                                                                                                                                                                        |

Round 6, full-path report-only review of `39c401e4` (0 P0, 0 P1, 1 P2, 6 P3):

| Finding                                                                       | Sev | Lens                           | Disposition                                                                                                    |
| ----------------------------------------------------------------------------- | --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| The Breaking bullet "must answer the same options" misses the throwing case   | P2  | adversarial                    | Fixed in `1059dc39`; restated in round 7 below                                                                 |
| The removed-static bullet has no migration step                               | P3  | project-standards, adversarial | Fixed: points at the `Configuration.defaultOptions` effect                                                     |
| The learning states an identity that fails outside the project and on Windows | P3  | adversarial, learnings         | Fixed: states the derivation, the outside-project case and its gate                                            |
| The spelling claim implies Windows nesting                                    | P3  | adversarial                    | Fixed in round 7: KTD4 now matches nested paths on Windows                                                     |
| The `run --plan --shard` parent now reads the config once                     | P3  | correctness                    | Accepted: the parent is a `run` invocation; its own stream follows the config; children keep the explicit flag |
| AE7 is not a refusing endpoint (boundary-testing `real-system-oracles`)       | P3  | boundary-testing pack          | Disputed, as round 5; round 7's pack lens rules it comply                                                      |

Round 7, full-path report-only review of `1059dc39` (0 P0, 0 P1, 1 P2, 7 P3):

| Finding                                                                             | Sev | Lens        | Disposition                                                                                             |
| ----------------------------------------------------------------------------------- | --- | ----------- | ------------------------------------------------------------------------------------------------------- |
| Every option but the stream path now comes from the config function's second answer | P2  | adversarial | Fixed: the Breaking bullet says so and requires the same answer each time; Assumptions records it       |
| Nested absolute outputs miss on Windows                                             | P3  | correctness | Fixed: KTD4. The finding's premise that `main` matched is false; the probe shows `main` missed them too |
| A `..foo` directory is judged outside the project                                   | P3  | correctness | Fixed: `isInsideProject` tests a `..` segment, not a prefix                                             |
| Bullet 1 is false for an empty `progressStreamFile`                                 | P3  | adversarial | Fixed: "a non-empty `progressStreamFile`"                                                               |
| Bullet 1 reads as every command                                                     | P3  | learnings   | Fixed: "a mutation run's stream"                                                                        |
| The migration pointer is an Effect, not a string                                    | P3  | adversarial | Fixed: "the `Configuration.defaultOptions` effect yields `progressStreamFile`"                          |
| `test/e2e/AGENTS.md:37` states the default unconditionally                          | P3  | learnings   | Deferred to Stream K, which owns `test/e2e`; true for its fixtures                                      |
| The "must not fail on a later call" break has no test                               | P3  | testing     | Not admitted: it pins a double evaluation OQ5 may remove; the Config failures smoke row measures it     |
| The learning's outside-project clause has no gate                                   | P3  | testing     | Not admitted: no observable behaviour for a truly outside path; the symlinked-root case is round 8's P2 |

Round 8, full-path report-only review of `7a3af040` (0 P0, 0 P1, 1 P2, 4 P3):

| Finding                                                                                 | Sev | Lens        | Disposition                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An absolute output spelled through a symlinked or differently cased root stays an input | P2  | adversarial | Accepted, narrowed: R7, Key Decisions and the learning state that containment is lexical; the changeset names only the proven spellings. Not a regression: on `main` the default stream was not excluded, so any configured path already re-ran every mutant (variant A) |
| A `progressStreamFile` naming the project root makes the drain's file write fail        | P3  | adversarial | Superseded by round 9: the `stdout` clause was false; U7 fixes it                                                                                                                                                                                                        |
| READMEs credit the config file for every command                                        | P3  | learnings   | Fixed: "or for `stryker run` also the config file"                                                                                                                                                                                                                       |
| No nested or absolute AE3 row                                                           | P3  | testing     | Superseded by round 9: the nested `./` row fails on `main`, so AE3 gains it; the absolute row stays out (lexical containment, probe below)                                                                                                                               |
| The win32 guarantee rests on a probe, not a committed `Path` win32 test                 | P3  | correctness | Not admitted: the derivation is module-private in a cell; a test would need a new export only to test it. The Output rules probe is recorded                                                                                                                             |

Round 9, full-path report-only review of `25a46beb` (0 P0, 0 P1, 1 P2, 6 P3):

| Finding                                                                                     | Sev | Lens        | Disposition                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A stream path naming a directory drops every `stdout` record, now reachable from the config | P2  | correctness | Fixed: U7, R9, AE8. Measured on `main`: the flag already dropped them (exit 0, no records); the config value did not, because `main` ignored it |
| The nested `./` spelling has no row although it fails on `main`                             | P3  | correctness | Fixed: AE3 row, failing first on `main`                                                                                                         |
| Shard children's streams stay inputs of a later plain run                                   | P3  | adversarial | Accepted, narrowed: the Objective no longer claims every command; OQ6. Same on `main`                                                           |
| The config is read twice, so a shadowed legacy config warns twice                           | P3  | adversarial | Accepted: already in Assumptions; OQ5 now names it                                                                                              |
| README and changeset state the exclusion without the lexical caveat                         | P3  | adversarial | Accepted: both state it for paths as users write them; the lexical edge is in R7 and the learning                                               |
| R4's flag arm on a refused config has no row                                                | P3  | testing     | Not admitted: the arm reuses `flaggedRequestOf`, the flag path AE4 grades; a row adds a CLI spawn to the PR gate for one `orElseSucceed`        |
| The changeset had 8 bytes left under the 900-byte ceiling                                   | P3  | standards   | Fixed: rewritten for U7 with the validator passing                                                                                              |
| `mutation-lane-green-while-every-job-failed.md` names symbols #191 removed                  | P3  | learnings   | Deferred: pre-existing; this PR edits one parenthetical. A `ce-compound-refresh` of that learning owns it                                       |

Round 10, full-path report-only review of `bfad43ca` (0 P0, 0 P1, 1 P2, 6 P3):

| Finding                                                                                  | Sev | Lens                     | Disposition                                                                                                                   |
| ---------------------------------------------------------------------------------------- | --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| U7 covers only the open; a refused write still ends the drain with no log                | P2  | correctness, adversarial | Fixed: `writeLineOf` logs the first failure and stops writing the file; R9 and AE8 (`/dev/full`, failing first on `bfad43ca`) |
| R9's flag arm has no row                                                                 | P3  | testing                  | Fixed: AE8's `/dev/full` row passes the flag                                                                                  |
| R9's log clause is graded by nothing; AE8 claims "every record"                          | P3  | testing, boundary pack   | Fixed: AE8 asserts `stderr` names `stryker.output.drain_file_failed`; the scenario names what it asserts                      |
| A stale shard stream file survives an unwritable child and passes merge                  | P3  | adversarial              | Accepted: as on `main`; OQ6 now asks it                                                                                       |
| The waiver's case 1 names one of three ungraded functions                                | P3  | project-standards        | Fixed: case 1 names `streamedRequestOf`, `flaggedRequestOf`, `pinnedRequestOf`                                                |
| The verdict-cache learning's gate names a bare file, unlike its siblings                 | P3  | learnings                | Fixed: the gate is a runnable command                                                                                         |
| `first-publish-under-oidc-trusted-publishing.md` cites a release flow `release.yml` lost | P3  | learnings                | Deferred: pre-existing, outside this diff; a `ce-compound-refresh` of the release learnings owns it                           |

Round 11, full-path report-only review of `014b542a` (0 P0, 0 P1, 2 P2, 7 P3):

| Finding                                                                                 | Sev | Lens                                | Disposition                                                                                                                                |
| --------------------------------------------------------------------------------------- | --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| AE8 grades that the failure is logged, not that it is logged once                       | P2  | testing, adversarial                | Fixed: AE8 counts `stryker.output.drain_file_failed` on `stderr` and expects exactly 1                                                     |
| A failed sync latches the file, so a transient failure never recovers                   | P2  | adversarial                         | Accepted, stated: R9 names the sync; Assumptions explains why a file after a failed `fsync` is not extended                                |
| The write leg's `catchCause` logs interruptions and defects as file failures            | P3  | correctness                         | Fixed: `tapError` and `orElseSucceed` handle typed failures only, on both the open and the write leg                                       |
| R9's "every record reaches `stdout`" overreaches in human mode                          | P3  | correctness                         | Fixed: R9 is stated for `--json`; human mode keeps only the log                                                                            |
| `/dev/full` degrades into an open-failure row where the device is missing               | P3  | testing, adversarial, boundary pack | Fixed: the Given refuses to run without `/dev/full`; CI runs `ubuntu-latest` only                                                          |
| Two spellings of the file-failure log name                                              | P3  | cell pack, boundary pack            | Fixed: one `DRAIN_FILE_FAILED` constant in the service                                                                                     |
| A short write leaves a torn last line                                                   | P3  | adversarial                         | Accepted: as on `main`; Assumptions names it                                                                                               |
| The learning cites `StrykerOptions` where the schema constant is `StrykerOptionsSchema` | P3  | learnings                           | Fixed                                                                                                                                      |
| `packages/stryker-js/README.md:200` says Stryker "never" counts the file                | P3  | learnings                           | Fixed: the sentence names the run's own resolved and default paths and re-runs with the same settings; it also states the file-failure log |

Round 12, full-path report-only review of `54aeca2b` (0 P0, 0 P1, 1 P2, 6 P3):

| Finding                                                                              | Sev | Lens                                                      | Disposition                                                                                                              |
| ------------------------------------------------------------------------------------ | --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A defect in a write now ends `stdout` instead of being latched                       | P2  | adversarial                                               | Accepted, stated in R9: a defect is a bug by Effect's contract; recovering would hide it. It is logged as `drain_failed` |
| The drain backstop logs defects and interruptions as `drain_file_failed`, against R9 | P3  | correctness, testing, standards, learnings, boundary pack | Fixed: the backstop logs under `stryker.output.drain_failed`                                                             |
| A sharded run evaluates the config once more per child                               | P3  | adversarial                                               | Accepted: OQ5 names it                                                                                                   |
| A configured path's glob syntax still compiles as a glob; Assumptions said otherwise | P3  | adversarial                                               | Fixed: Assumptions corrected; OQ7 asks whether output entries should match literally                                     |
| The learning's "the CLI hands its resolved name" names no call site                  | P3  | learnings                                                 | Fixed: names `pinnedRequestOf` and the config merge it wins                                                              |
| The `/dev/full` row dies rather than skips off Linux                                 | -   | testing, adversarial (residual)                           | Accepted: a skip reads as green; CI is `ubuntu-latest` only                                                              |

Round 13, full-path report-only review of `2838944a` (0 P0, 0 P1, 0 P2, 6 P3):

| Finding                                                                                     | Sev | Lens                            | Disposition                                                                                                                               |
| ------------------------------------------------------------------------------------------- | --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| The Definition of Done lists OQ1-OQ6 while OQ7 exists                                       | P3  | learnings, testing, adversarial | Fixed                                                                                                                                     |
| `stryker.output.drain_failed` is a literal spelled twice                                    | P3  | standards, boundary pack        | Fixed: one `DRAIN_FAILED` constant at both sites                                                                                          |
| R9 says a drain defect "is not recovered" while the backstop ignores it                     | P3  | adversarial                     | Fixed: R9 says the drain stops, its remaining records are lost and the exit code is unchanged, as on `main`                               |
| A failure closing the file reaches the backstop and is logged as `drain_failed`             | P3  | correctness                     | Accepted, stated in R9                                                                                                                    |
| R7 and the package README claim any spelling; `!` or `[` in a path still compiles as a glob | P3  | correctness                     | Fixed: R7 names separators and points glob syntax at OQ7; the README tells users to keep glob characters out of the path                  |
| The backstop's log name has no test                                                         | P3  | testing, adversarial            | Not admitted: the built CLI reaches the backstop only through a defect or an interruption, which no test can stage without editing source |

### Verification Contract

| Check           | Command                                                                                                                                                                                                                                                                 | Pass                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Failing before  | U1's scenarios against the binaries named in U1                                                                                                                                                                                                                         | fail as U1 states                                                                             |
| Behaviour       | `vitest run tests/progress-stream-file.integration.test.ts` after building `dist`                                                                                                                                                                                       | passes                                                                                        |
| Neighbours      | `vitest run tests/plan-stream-location.integration.test.ts tests/rerun-by-id.integration.test.ts tests/incremental-reuse.integration.test.ts tests/clean-temp-dir.integration.test.ts tests/shard-merge.integration.test.ts tests/run-event-stream.integration.test.ts` | pass                                                                                          |
| Config failures | a throwaway CLI run on `main`'s binary and the branch's: a config that throws, a missing `--configFile`, an invalid option, a `null` `progressStreamFile`, a function that throws on its second call                                                                    | first four identical (exit, records, error, stream location); the fifth as Assumptions states |
| Output rules    | a throwaway probe applying the rule derivation and `crawlDirectory`'s entry naming under `path.posix` and `path.win32` to every AE3 spelling, nested, absolute and `..foo` entries                                                                                      | rule equals the crawl's entry path in every case                                              |
| Types and lint  | `tsc -b`, `pnpm run lint:tsgo`, oxlint on the touched files, `dprint check`                                                                                                                                                                                             | clean                                                                                         |
| Changeset       | the `author-changesets` validator; bump `major`                                                                                                                                                                                                                         | OK                                                                                            |
| Review          | full-path `ce-code-review`, report-only, on the final head                                                                                                                                                                                                              | every finding has a disposition                                                               |
| CI              | the PR head's check suites                                                                                                                                                                                                                                              | every required check green; Bench reported, not chased                                        |

No mutation run, local or dispatched: mutation evidence for this change comes from the next nightly on `main`.

## Definition of Done

- U1-U7 have landed in one PR off `main`, and every Verification Contract row holds on its head.
- The PR body carries the failing-first evidence, the review lenses, the models that actually served them, every pack ruling, and OQ1-OQ7.
