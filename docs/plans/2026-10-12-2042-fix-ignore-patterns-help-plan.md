---
title: The --ignorePatterns help says what Stryker always ignores - Plan
type: fix
date: 2026-10-12
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# The --ignorePatterns help says what Stryker always ignores - Plan

## Goal Capsule

- **Objective:** a user who reads `stryker run --help` knows exactly which files Stryker leaves out of the project regardless of their `ignorePatterns`. No one is led to drop a pattern they still need, or to keep one they don't.
- **Authority:** `CONSTITUTION.md`, then root `AGENTS.md`, then this plan. Stream J owns the CLI surface. This is one small PR off `main`.
- **Open blockers:** none.

---

## Product Contract

### Summary

Rewrite the always-ignored part of the `--ignorePatterns` description so it names the patterns the engine actually applies. It names Stryker's own output files separately, by the options that set them, and says that `reports/` as a whole is not ignored. The listed patterns come from the same values the engine applies, so the help cannot fall behind again.

### Problem Frame

The `--ignorePatterns` description (`packages/stryker-js/src/bin/cli-command.ts:61`) says the patterns `node_modules`, `.git`, `/reports`, `*.tsbuildinfo`, `/stryker.log` and `.stryker-tmp` are ALWAYS ignored. That list is wrong in three ways:

- **`/reports` was never ignored here.** `ALWAYS_IGNORE` (`packages/stryker-js/src/read-project.cell.ts:33-42`) has never contained it on this repository's history: not at its first commit `7340de55` (`Project.ignore.ts`), not at tag `@systemfsoftware/stryker-js@v17.0.2`, and not on main `ee7038a5`. The sentence came over with the upstream StrykerJS text, and nothing ever checked it against the engine.
- **Four patterns the engine does apply are missing:** `.next`, `.nuxt`, `.svelte-kit` and `.turbo`.
- **`.stryker-tmp` is not a fixed pattern.** It is the default `tempDirName`. The engine excludes Stryker's own outputs one file at a time, by option (`strykerOutputFilesOf`, `packages/stryker-js/src/stryker-outputs.ts:8-21`, applied at `read-project.cell.ts:116-124`): `tempDirName`, `incrementalFile`, `progressStreamFile`, `htmlReporter.fileName`, `jsonReporter.fileName`, the SARIF file beside the JSON report, and `reports/mutation/reproducers.json`. Other files under `reports/` stay in the project.

A downstream root acted on the stale text and set `ignorePatterns: []`, believing `reports/` stayed ignored.

### Requirements

- R1. The `--ignorePatterns` help lists every fixed pattern the engine ignores whatever `ignorePatterns` says, and no pattern it does not ignore.
- R2. The help says Stryker's own output files are always excluded, names the options that place them, and says other files under `reports/` are not ignored.
- R3. The help and the engine read the always-ignored patterns from one source, so a change to the engine's list changes the help.
- R4. Stryker's own output files never enter the project files that verdict reuse reads, whatever `ignorePatterns` holds. The scenario "A first repeat run under default ignore patterns reuses every verdict" (`packages/stryker-js/tests/incremental-reuse.integration.test.ts:658-696` on main) stays unchanged and passes.
- R5. A patch changeset tells consumers what the help now says, and that `reports/` content other than Stryker's own outputs was never excluded.

### Key Decisions

- **The help is built from the engine's own list, not written out by hand.** Governs R3.
  - Rejected: a text-only fix. A hand-written list is how this defect happened: the help and `ALWAYS_IGNORE` were two copies with nothing joining them, and they disagreed from the first commit. A second hand-written copy recreates that.
  - Rejected: a hand-written list plus a test that compares it with the constant. That still keeps two copies and adds a gate that only exists to keep them in step. One source removes the need.
- **Stryker's outputs are named by option, not by default path.** Covers R2. The paths are configurable, so a default path like `reports/mutation/mutation.html` is only true for users who kept the default. The option names are true for everyone.
- **The proof is behavioural.** Covers R1, R4. A test that reads a string back from the constant it was built from certifies nothing (`AGENTS.md` CHK1). The tests read the help the CLI actually renders and check it against what the engine actually leaves out of a real workspace.

### Acceptance Examples

- AE1. Covers R1. **Given** a workspace that holds a file under each pattern the help lists as always ignored. **When** Stryker reads the project with `ignorePatterns: []`. **Then** none of those files is in the project.
- AE2. Covers R1, R2. **Given** the same workspace with `reports/coverage/lcov.info`, a file no Stryker option writes. **When** Stryker reads the project with `ignorePatterns: []`. **Then** that file is in the project, and the rendered help does not claim `reports/` is ignored.
- AE3. Covers R4. The scenario at `incremental-reuse.integration.test.ts:658-696` passes unchanged: with `ignorePatterns: []`, a second run reuses every verdict although the first run wrote reports into the project.

### Scope Boundaries

- Only the always-ignored part of the `--ignorePatterns` description and its single source change. The rest of the description stays as it is (when to use the option, the example).
- The engine's ignore behaviour does not change: no pattern is added to or removed from `ALWAYS_IGNORE`, and output exclusion stays as it is.
- No CI, Turbo task graph or cache change. The turbo-query-optimization rule is not triggered.

### Outstanding Questions

- OQ1 (for the root, outside this PR). Two help sentences also look stale: "This option will have NO effect when using the `--inPlace` option" (`cli-command.ts:61`) and "Also with `true` the `ignorePatterns` has no effect any more" (`cli-command.ts:253`). `readProject` applies the ignore rules whether or not `inPlace` is set (`read-project.cell.ts:363-366`), so ignored files still leave mutate and test-file selection. With `inPlace` the option only stops saving copy time. Correcting both sentences is a separate claim about `inPlace`, so this PR leaves them and asks whether to queue it.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One module owns the always-ignored set.** A new `packages/stryker-js/src/project-ignores.ts` holds `ALWAYS_IGNORE` (moved verbatim from `read-project.cell.ts:33-42`) and builds the always-ignored sentences of the `--ignorePatterns` description. `read-project.cell.ts` and `bin/cli-command.ts` both import it. Governs R3.
- KTD2. **The output files and their option names come from one table.** `stryker-outputs.ts` turns its file list into a table of `{ option, fileOf }` rows. `strykerOutputFilesOf` maps `fileOf`, and the help maps `option`. The SARIF row is named "the SARIF file beside the JSON report" and the reproducers row by its fixed path, since no option sets either. Governs R2, R3.
- KTD3. **Tests go where the guarantee lives, and the oracle is independent.** A new `packages/stryker-js/tests/ignore-patterns.integration.test.ts` holds one hand-written table of always-ignored patterns, each with a sample path. Each scenario checks something different against that table:
  - The engine scenario runs `Engine.mutationTestCell` in-process with `coverageAnalysis: 'off'`, so every mutant runs the whole suite and any change to a project file refuses reuse with `closureChanged`. That is the same observable as `incremental-reuse.integration.test.ts:946-992`.
  - The help scenario runs the built `dist/main.mjs` in machine mode and decodes the `help` event (`RunEvent.HelpRendered`) through the published contract. It uses the same pattern as `rerun-by-id.integration.test.ts:73-90`, because the rendered help is visible only at the CLI seam.

  The two scenarios never read `ALWAYS_IGNORE`, so a pattern the help lists but the engine does not ignore fails the engine scenario, and a pattern the engine stops ignoring fails both.
- KTD4. **No CI or turbo change.** The new test file joins the package's existing `test` task, and its inputs already cover `tests/**`. The turbo-query-optimization rule is not triggered.

### Packs

- `cell-architecture` (`service-and-layer-boundaries`): `project-ignores.ts` is a plain data module with no service or layer, and the cell keeps its I/O.
- `boundary-testing` (`no-mocks-on-internal-glue`): both scenarios run the real engine or the real binary, with no double of the project reader.
- `schema-laws` (`tests-own-no-schemas`): the help scenario decodes through the published `RunEvent.RunEventWireLine` and declares no schema.
- `package-topology` does not apply: nothing is added to or removed from a published entry.

---

## Implementation Units

### U1. One source for the always-ignored set and the help

- **Goal:** R1, R2, R3.
- **Files:**
  - `packages/stryker-js/src/project-ignores.ts` (new)
  - `packages/stryker-js/src/stryker-outputs.ts`
  - `packages/stryker-js/src/read-project.cell.ts`
  - `packages/stryker-js/src/bin/cli-command.ts`
- **Approach:** move `ALWAYS_IGNORE` into the new module and table the outputs per KTD2. Replace the stale always-ignored sentences of the `--ignorePatterns` description with the derived ones. They list the patterns, list the outputs by option, and say other `reports/` files are not ignored. The remaining sentences are unchanged (OQ1).
- **Test expectation:** behaviour proven by U2.

### U2. Help-contract and exclusion scenarios

- **Goal:** R1, R2, R4 (AE1, AE2).
- **Files:** `packages/stryker-js/tests/ignore-patterns.integration.test.ts` (new).
- **Test scenarios:**
  - **Engine exclusion (AE1, AE2):** after a first run with `ignorePatterns: []`, a file is written under each pattern in the table, and a second run reuses every verdict with no refusal. Writing `reports/coverage/lcov.info` makes a third run refuse every verdict with `closureChanged`.
  - **Help contract (AE1, AE2):** the rendered help lists exactly the table's patterns as always ignored, names each output option, says other `reports/` files are not ignored, and does not list `/reports`.
- **Verification:** both scenarios pass on the branch. Run against `main`'s built binary, the help scenario fails, which shows the test catches the stale promise. No source is edited to stage a failure.

### U3. Changeset

- **Goal:** R5.
- **Files:** `.changeset/<name>.md`, patch for `@systemfsoftware/stryker-js`.

---

## Verification Contract

| Check         | Command (from `packages/stryker-js`)                                                        | Done signal                                            |
| ------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Typecheck     | `tsc -b --force`                                                                            | exit 0                                                 |
| Lint, format  | `oxlint` on the touched files, `lint:tsgo`; repo root `./bin/dprint check`                  | exit 0                                                 |
| New scenarios | `vitest run tests/ignore-patterns.integration.test.ts` after building `dist`                | 2 passed                                               |
| R4 scenario   | `vitest run tests/incremental-reuse.integration.test.ts -t "under default ignore patterns"` | passes unchanged                                       |
| Smoke         | `node dist/main.mjs run --help`                                                             | the derived sentences render                           |
| Changeset     | the author-changesets validator                                                             | OK                                                     |
| Review        | `ce-code-review` report-only with the cross-model pass                                      | every finding has a disposition                        |
| CI            | `xd://github run_watch` on the PR head                                                      | every required check green; Bench reported, not chased |

## Definition of Done

- U1-U3 have landed in one PR off main, and every Verification Contract row holds on its head.
- The PR body names the review lenses, the non-Claude model that actually served the cross-model pass, and OQ1.
