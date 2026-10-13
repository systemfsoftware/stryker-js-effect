---
title: A configured progress stream file stays out of the next run's inputs - Plan
type: fix
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# A configured progress stream file stays out of the next run's inputs - Plan

## Goal Capsule

- **Objective:** a project that sets `progressStreamFile` in its Stryker config gets its stream written at that path, and an unchanged project re-run through the `stryker` CLI reuses every verdict, whatever its `ignorePatterns` (including `[]`).
- **Authority:** `CONSTITUTION.md`, then root `AGENTS.md`, then this plan. Stream J owns the CLI surface. This PR lands before PR #320 (the `--ignorePatterns` help text), which waits on it.
- **Citations:** line numbers name `main` at `ec1769de`, the base this branch was cut from.
- **Open blockers:** none for this unit. OQ1 goes to the root and does not gate it.

---

## Product Contract

### Summary

`stryker run` writes its event stream to the path the CLI flags name, or to `reports/mutation-stream.jsonl`, and never reads `progressStreamFile` from the config file. The engine excludes the configured path from the project's inputs. So with `progressStreamFile` set in the config, the stream lands in an unexcluded file, its fresh `runId` changes the project digest every run, and every mutant re-runs. The fix makes the stream follow the same resolved configuration the engine uses.

### Problem Frame

Measured through the built CLI on `ec1769de`: two runs of a real temporary project with nothing changed in between (`ignorePatterns: []`, `testRunner: 'command'`):

| Variant                                                  | Second run                          |
| -------------------------------------------------------- | ----------------------------------- |
| A. `progressStreamFile: 'out/stream.jsonl'` in config    | reused 0, ran 2, `closureChanged` 2 |
| B. A plus `--progressStreamFile out/stream.jsonl`        | reused 2, ran 0                     |
| C. no `progressStreamFile` (default path)                | reused 2, ran 0                     |
| D. A, default-path stream deleted between runs           | reused 0, ran 2                     |
| E. A, atomic-write temp directories deleted between runs | reused 0, ran 2                     |

After run 1 in A, `out/stream.jsonl` does not exist and `reports/mutation-stream.jsonl` does. D shows the second run rewrites that file before the project is read. B and E show the leftover `out/incremental.json.<hex>/` directories play no part.

Cause in code:

- `readRunRequest` sets the drain's file from `invocation.options`, the command-line options only (`packages/stryker-js/src/run-request.cell.ts:132-148`), then opens the stream.
- The drain reads that name once and opens the file with flag `w` as the stream opens (`packages/stryker-js/src/run-event-stream.service.ts:162-181`, `:510-526`).
- The config file is read later, inside the engine's `loadConfigCell` (`packages/stryker-js/src/run/run-stages.cell.ts:23`). Its resolved `progressStreamFile` feeds the exclusion list (`packages/stryker-js/src/stryker-outputs.ts:8-21`) but never the drain.

### Requirements

- R1. When the `run` command's resolved configuration names `progressStreamFile`, the run writes its event stream at that path, and writes no stream at `reports/mutation-stream.jsonl`.
- R2. The precedence stays as the engine applies it: a `--progressStreamFile` flag wins over the config file, and the config file wins over the default.
- R3. An unchanged project run twice through the CLI with `progressStreamFile` in its config and `ignorePatterns: []` re-runs no mutant on the second run.
- R4. A config file that cannot be read or is invalid is reported exactly as today. The stream still opens, at the flag or default path.
- R5. Every other subcommand keeps its current stream path.

### Acceptance Examples

- AE1. Covers R1, R3. A project whose config sets `progressStreamFile: 'out/stream.jsonl'`, `ignorePatterns: []` and a JSON report at `out/report.json` is run twice with `stryker run --json`. After the second run, `out/stream.jsonl` holds a `reuse` record with `ran: 0` and `reused` equal to the number of mutants in `out/report.json`, and `reports/mutation-stream.jsonl` does not exist.
- AE2. Covers R2. The same project run with `--progressStreamFile other.jsonl` writes `other.jsonl` and not `out/stream.jsonl`. This is already true and is exercised by the shard children (`packages/stryker-js/src/shard/shard-run.ts:43`) and `tests/plan-stream-location.integration.test.ts:238`.

### Scope Boundaries

- Only the path the `run` command's stream is written to changes. The ignore rules, the output-exclusion list and the digest do not change.
- The atomic-write temporary directories are out of scope: they are empty directories, not files, and variants B and E show they do not reach the digest. They accumulate, three per run, which is OQ1.
- No help text, README or contract change: the README documents the stream file only through `--progressStreamFile` (`README.md:303`, `packages/stryker-js/README.md:200`), and that stays true.
- No CI, Turbo, cache, workflow, fixture or timeout change. No local mutation run.

### Key Decisions

- **The stream path is resolved through the engine's own config resolution before the stream opens.** Covers R1, R2. `readConfig` (`packages/stryker-js/src/run/load-config.ts:99-121`) is what `stryker run --survivors` and `--mutant` already call in the CLI before the engine runs (`Survivors/Survivors.cell.ts:124`, `Rerun/Rerun.cell.ts:43`). It needs only the file system and path services, and a second import of the config module returns Node's cached module (no cache-busting query, `run/read-config-document.ts:219-233`).
  - Rejected: excluding the file the drain actually wrote from the digest. The configured option would stay silently ignored and the stream would keep landing in the wrong place.
  - Rejected: holding the stream file until the engine reports its resolved options. That needs a new channel from the engine to the drain, through the event spine another workstream is refactoring.
  - Rejected: refusing `progressStreamFile` in the config file. That is a breaking API change, and the root's outcome names a configured `progressStreamFile`.
- **A config that cannot be resolved here falls back to today's path.** Covers R4. The engine's own load reports the failure, so no error is reported twice or earlier.

### Outstanding Questions

- OQ1 (for the root, outside this PR). `writeFileAtomic` (`packages/stryker-js/src/atomic-write.cell.ts:20-24`) asks for a temp file next to the target. Effect's `makeTempFile` creates a temp directory `<dir>/<prefix><hex>/` and the file inside it (`@effect/platform-node-shared` `NodeFileSystem.ts:428-437`). The rename moves the file out and leaves the empty directory, three per run, so they pile up in the project. Should a separate unit remove them?

### Sources

- Two-run CLI variants above: run on `ec1769de` with `packages/stryker-js/dist/main.mjs`, in throwaway projects under `/tmp`, deleted afterwards.

---

## Planning Contract

### Key Technical Decisions

- KTD1. `readRunRequest` (`packages/stryker-js/src/run-request.cell.ts:144-156`) resolves the stream file before `drain.setProgressStreamFile`. For the `run` route it calls `readConfig(invocation.options, { command: 'run', mode })` and takes `progressStreamFile` from the resolved options. That value already carries the flag-over-config-over-default precedence (R2). On any `ConfigReadError` it keeps today's path, taken from the flags or the default (R4). Every other route keeps today's path (R5).
- KTD2. No new module or decision cell. The precedence is `resolveConfig`'s existing decision, and the route check is one `Match` on the route tag inside the read side of the existing cell.
- KTD3. The test drives the built `stryker` binary. `test-layer-selection` refuses process spawning in an integration test, but the root's rule for this unit requires the built CLI, and the defect lives only in the CLI's request read: `Engine.strykerCell` and `./promises` `run()` never call `readRunRequest`. The package already drives `dist/main.mjs` the same way in `tests/rerun-by-id.integration.test.ts` and `tests/plan-stream-location.integration.test.ts`.

### Assumptions This Breaks

- "The config file is read once per `stryker run`." It is now read twice. `--survivors` and `--mutant` already read it twice (`Survivors/Survivors.cell.ts:124`, `Rerun/Rerun.cell.ts:43`). The module is evaluated once, because Node caches the import. A config whose default export is a function is called twice; that is also already true for those two flags.
- "The stream header is written before any config work." The first `stdout` line now waits for the config import. Its content does not change. A config import that hangs now hangs before the header instead of after it.
- "A config failure surfaces only from the engine." Preserved by KTD1's fallback: the failure here is dropped and the engine reports it, as today.

### Prior Art

- The same defect class in Turborepo: outputs left inside a task's inputs miss the cache on the next run ([vercel/turborepo#7784](https://github.com/vercel/turborepo/issues/7784)), and the fix is to exclude the outputs from the inputs ([vercel/turborepo#7480](https://github.com/vercel/turborepo/discussions/7480)). Here the exclusion already exists; the output went to a path it does not name.
- The software wiki returned nothing on this topic.

### Implementation Units

#### U1. Behaviour test, failing first

- **Goal:** AE1.
- **Files:** new `packages/stryker-js/tests/progress-stream-file.integration.test.ts`.
- **Test scenarios:** one feature, one scenario. A real temporary project with `ignorePatterns: []`, `progressStreamFile: 'out/stream.jsonl'` and a JSON reporter at `out/report.json` is run twice through `dist/main.mjs run --json`. The `Then` step reads only the user-visible files: the `reuse` record in `out/stream.jsonl` after the second run, the mutant count in `out/report.json`, and whether `reports/mutation-stream.jsonl` exists.
- **Verification:** run against `main`'s binary before U2, it fails with the configured stream missing and the default one present. No production source is edited to stage the failure.

#### U2. Resolve the stream file through the config

- **Goal:** R1, R2, R4, R5.
- **Files:** `packages/stryker-js/src/run-request.cell.ts`.
- **Verification:** U1 passes. `tests/plan-stream-location.integration.test.ts` and `tests/rerun-by-id.integration.test.ts`, which pass the flag, still pass. Typecheck, `lint:tsgo` and oxlint are clean for the package.

#### U3. Changeset

- **Files:** a patch changeset for `@systemfsoftware/stryker-js`, checked by the `author-changesets` validator.

### Verification Contract

| Check          | Command                                                                                           | Pass                                                   |
| -------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Failing before | U1 against `main`'s built binary                                                                  | fails as U1 states                                     |
| Behaviour      | `vitest run tests/progress-stream-file.integration.test.ts` after building `dist`                 | passes                                                 |
| Neighbours     | `vitest run tests/plan-stream-location.integration.test.ts tests/rerun-by-id.integration.test.ts` | pass                                                   |
| Types and lint | `tsc -b`, `pnpm run lint:tsgo`, oxlint on the touched files, `dprint check`                       | clean                                                  |
| Changeset      | the `author-changesets` validator                                                                 | OK                                                     |
| Review         | `ce-code-review`, report-only                                                                     | every finding has a disposition                        |
| CI             | `xd://github run_watch` on the PR head                                                            | every required check green; Bench reported, not chased |

No mutation run, local or dispatched: mutation evidence for this change comes from the next nightly on `main`.

## Definition of Done

- U1-U3 have landed in one PR off `main`, and every Verification Contract row holds on its head.
- The PR body names the review lenses, the models that actually served them, and OQ1.
