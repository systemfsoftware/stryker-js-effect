---
title: Manifest exports the resolver cannot read stop making the whole package.json unreadable - Plan
type: fix
date: 2026-10-13
supersedes: docs/plans/2026-10-13-0239-fix-manifest-exports-decode-plan.md
topic: manifest-exports-decode
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Manifest Exports Decode - Plan

## Goal Capsule

- **Objective.** A project that links a workspace package whose `package.json` declares `exports` in any shape Node accepts keeps its verdicts across an edit no test reaches, and re-tests them after an edit to the file the runtime loads.
- **Means.** Decode every manifest key the resolver reads as plain JSON and interpret entries inside the pure decision, resolving each condition object to the file the runtime loads (KTD1, KTD2).
- **Authority.** Conductor intent r41 (`.rulings/stream-d-r41-manifest-exports-intent.md`) as clarified by r46 (`.rulings/stream-d-r46-pr330-debate.md`) > this plan > the repo's packs and `CONSTITUTION.md`.
- **Stop.** One PR off `origin/main` (#330), green on its exact head, with a patch changeset for `@systemfsoftware/stryker-js`, the review receipt and per-finding dispositions in its body.
- **Why superseded.** U1-U3 of the 0239 plan shipped on `14a06fdab`. Its full-path review confirmed a P1: the first-value rule closes a `types`-first condition object over a `.d.ts` no runtime loads, so a runner that reports no `testFileModules` reuses a stale verdict after a runtime-only edit. r46 clarified that R3 means no correctness regression, not preserving a stale resolution. KTD2's condition rule, R3, OQ1 and the scope change with it, and U4 is added; the 0239 plan never reached `main` and is replaced in this PR.

## Product Contract

### Summary

The import closure decides which files a test file depends on. Incremental runs reuse a mutant's verdict while the closures of its covering tests stay the same. For a workspace-linked package, the closure reads that package's `package.json` to map an import to a file. On `main`, one `exports` shape outside a two-level, string-only grammar fails the decode of the whole file, so every import of that package opens its closure and reuse stops for every test that imports it.

### Requirements

- R1. A linked package whose `exports` holds nested condition objects, array fallbacks, root conditions without a `.` key, or `null` targets resolves its imports, so an edit to a file no test reaches leaves every verdict reused. Observable as the second run's `reuse` event: `ran` is 0 and no refusal counts a mutant.
- R2. A manifest key whose value the resolver cannot interpret affects only the requests that read that key's entry. It never refuses the other keys or the rest of the file. This holds for `exports`, `imports`, `main` and `module`.
- R3. Every specifier resolves to the file the runtime loads, or leaves its importers' closures open; never to a file no runtime loads. Every `#` import and node builtin that #308 closed stays closed.
- R4. An entry the resolver cannot map (a `null` target, an array whose first element is `null`, a condition branch ending in `null`, a condition object whose first condition past `types` is not `import`, `node` or `default`) yields no target, and that is final: no pattern and no `main`/`module` rescues it. So the closures that import it stay open.
- R5. Exit codes, log lines, report files and stream lines are unchanged for projects without the bug.

### Acceptance Examples

- AE1 (R1). A project links `@fixture/lib` whose `exports` is `{".": {"import": {"types": "./dist/index.d.ts", "default": "./dist/index.js"}}}`, the shape r41 names. Run 1 tests every mutant. A file no test imports is edited. Run 2 exits 0, and its `reuse` event reports `ran: 0` and `reused` equal to run 1's tested count, with every refusal 0.
- AE2 (R1). The same with `exports` `{".": ["./dist/index.js"]}`, `["./dist/index.js"]`, `{".": "./dist/index.js", "./internal/*": null}`, and, on a runner that reports no loaded modules, `{".": {"types": ..., "default": ...}}` and root conditions `{"types": ..., "import": ...}`.
- AE3 (R1, control). The same with flat `exports` `{".": "./dist/index.js"}`. This passes on `main` today, which shows the harness measures the bug rather than its own setup.
- AE4 (R4). Proven by U2's laws only. `main` already keeps such closures open (the whole manifest fails), so a CLI scenario could not fail there.
- AE5 (R3). A `types`-first package (nested and flat) on a runner that reports no loaded modules: only the package's `.js` changes between the runs, and run 2 tests again every mutant run 1 tested, refusing reuse for `closureChanged`. The same on the Vitest-backed `vm` runner, which reports loaded modules.

### Scope Boundaries

- The condition rule: `@systemfsoftware/source` first (the workspace's own condition); otherwise the first key past `types` and `types@…` decides, and only `import`, `node` and `default` yield a target. `require`, `browser`, `module`, `module-sync`, `development` and user conditions leave the closure open, because the importer's syntax and the runner's resolver decide them and the static reader knows neither.
- Array fallbacks keep the first-element rule. Node's `PACKAGE_TARGET_RESOLVE` continues past an element that is an invalid target or resolves to `null`, and never past a valid target whose file is missing; the first element yielding no target leaves the closure open, which is slow, never stale. Matching Node's continuation is not here.
- Not here: Stream B's reuse suites (`plan-stream-location`, `incremental-reuse`, `lockfile-closure-digest` and the others). A new suite is added instead.
- Not here: the schema-laws `rich-type-over-foreign-encoded` exception for decoding these keys as `S.Json`; it is held for the root's ruling.

### Sources

- `packages/stryker-js/src/import-closure.schema.ts` on `main`: `ExportEntrySchema` and the `exports` union; `imports` already `S.Json` (#308).
- `packages/stryker-js/src/import-closure.cell.ts`: `manifestOf` maps a failed decode to `undefined`, and `manifestTargetOf` maps `undefined` to `ManifestTargetMissing`; a chosen target becomes a member only if a candidate file exists; otherwise the resolution is `Unresolved`.
- `packages/stryker-js-cli-contract/src/run-event.schema.ts`: `ReuseRefusals` and the `reuse` event a run prints on stdout in machine mode.
- Node `doc/api/packages.md`, "Conditional exports" and "Community Conditions Definitions": Node matches conditions in key order against `node`, `import`, `require`, `module-sync`, `default` and user conditions, and never `types`; an `exports` object with no `.`-prefixed key is sugar for `{".": {...}}`, and mixing both kinds of key is an invalid package configuration.
- Node `doc/api/esm.md`, resolution algorithm: `PACKAGE_RESOLVE` uses `exports` only when it "is not null or undefined"; in `PACKAGE_TARGET_RESOLVE`, an array continues only on an invalid target or `undefined`, and `null` returns `null`.
- `CompleteDryRunResult.testFileModules` (plugin interface): only the Vitest runner reports it; `analyzeImportClosure` adds each observed module to its test file's closure.
- `docs/solutions/performance-issues/strict-optional-key-in-a-third-party-manifest-schema-refuses-the-whole-manifest.md`: the rule this unit completes.

## Planning Contract

### Key Technical Decisions

- KTD1. **`PackageManifestSchema` declares `exports`, `imports`, `main` and `module` as `S.optionalKey(S.Json)`.** The decode then fails only when `package.json` is not a JSON object. `main` and `module` are read as targets only when they are strings. `ExportEntrySchema` and its type are deleted along with their production uses. Rejected:
  - Widening the `exports` schema to Node's grammar with a recursive `S.suspend` union. It still refuses the whole file on any shape outside the grammar, and it duplicates in the schema the reading the decision already does.
  - Widening `exports` only. It leaves `main`/`module` able to refuse the file, against the rule the lesson records.
- KTD2. **One entry reader serves `exports` and `imports` at any depth, a present entry is final, and a condition object follows the runtime.**
  - Reading an entry:
    - a string is the target;
    - an array yields its first element, read again by the same reader;
    - an object yields its `@systemfsoftware/source` value if present; otherwise the first key past `types`/`types@…`, read again by the same reader, when that key is `import`, `node` or `default`; otherwise none;
    - `null` and every other value yield none.
  - A top-level `exports` string or array is the root entry. A top-level `exports` object with no `.`-prefixed key is the root's conditions; one mixing `.`-prefixed and other keys yields no target. A top-level `null` counts as absent, as in Node, so `main`/`module` apply.
  - Lookup separates "no entry for this request" from "an entry that yields no target":
    - **No entry:** no exact key and no matching pattern. Patterns, then `main`/`module` for the root.
    - **An entry that yields no target:** `ManifestTargetMissing`, with no pattern and no `main` consulted (R4).

  Rejected:
  - The first-value rule (the 0239 plan's choice). It closes a `types`-first object over a `.d.ts` no runtime loads; the review's confirmed P1.
  - Skipping `require` as never active. A CommonJS importer loads that branch, and the request does not carry the importer's syntax, so the closure stays open instead.
  - Keeping a declaration-only choice open while keeping first-value elsewhere (r46's minimal alternative). It still closes flat `{types, default}` on the `.d.ts`, the same stale path.
  - An array yielding its first element that yields a target. That skips `null`, which Node returns as blocked.
  - Falling through to patterns or `main` when an entry yields no target. That closes the closure on a file Node never loads.
- KTD3. **The user-observable test drives the built CLI.** `node dist/main.mjs run` runs twice on a temporary repo, with an edit between the runs, and the test reads only the exit codes and the `reuse` line of stdout. The `vm` runner reports the modules each test loaded, which can hide a stale static closure, so AE5 and the closure-only rows of AE2 use an on-disk runner fixture, `closure-only`, that reports no `testFileModules` (the on-disk runner pattern `dry-run-failure.integration.test.ts` uses).

### Plan Gates (plan-discipline rule)

- **Test-layer admission (`test-layer-selection`, `architect-property-tests` rule).** U2's laws draw the production `ManifestTargetCommand` schema and state relations over values derived from the draw. U3/U4 spawn the built CLI, which the skill's in-process gate refuses, but conductor intent r41 ("Ryan's rule") requires exactly this test and outranks the skill; the conflict is recorded here.
- **Wiki probe.** `software-wiki` returned no document on reading `package.json` `exports`.
- **Web probe.** Node's packages and ESM resolution documents (Sources).
- **Destructive review: assumptions it breaks.**
  - "First value is a safe approximation at any depth." It is not when the first branch is one no runtime takes (`types`); KTD2 now follows the runtime.
  - "A runner's observed modules make the static closure's file choice harmless." Only the Vitest runner reports them; KTD3 adds a runner that does not.
  - "An entry that yields nothing can fall back." It cannot: Node never falls back from a present entry.

### Sequencing

U1 → U2 → U3 → U4.

## Implementation Units

### U1. Manifest keys decode as JSON, entries read at any depth

- **Goal.** R1, R2, R4 at the decision.
- **Files.** `packages/stryker-js/src/import-closure.schema.ts`; `packages/stryker-js/src/select-manifest-target.workflow.ts`; `packages/stryker-js/src/__tests__/select-manifest-target.workflow.property.test.ts` (types only).
- **Approach.** KTD1 and KTD2. The lookup returns `Option<Option<string>>`: the outer layer says whether an entry exists, the inner one whether it yields a target.

### U2. Laws for the decision

- **File.** `packages/stryker-js/src/__tests__/select-manifest-target.workflow.property.test.ts`.
- **Laws.** Each draws `ManifestTargetCommand`:
  - `∀c_ConditionChain_≡FirstRuntimeConditionPastTypesAtEveryDepthForExportsAndImports`;
  - `∀c_ConditionChain_≡MissingWhenTheFirstConditionPastTypesIsNoRuntimeOne`;
  - `∀c_RootConditions_≡ReadAsTheRootEntryAndMissingBesideASubpathKey`;
  - `∀c_ConditionChain_≡SourceConditionBeforeEarlierKeysAtItsOwnDepth`;
  - `∀c_Fallbacks_≡TheFirstElementDecidesWhateverFollows`;
  - `∀c_RootEntry_≡MainDecidesTheRootOnlyWhenExportsDeclaresNone`;
  - `∀c_NullExports_≡ReadAsIfExportsWereAbsent`;
  - `∀c_ExactEntry_≡DecidesAloneWhateverPatternSitsBesideIt`;
  - `∀c_NonStringMainOrModule_≡ReadAsIfTheKeyWereAbsent`.
- **Evidence.** The first four fail against the first-value decision of `14a06fdab`; the rest failed against `main`'s decision when added. All pass on the head.

### U3. The built CLI keeps verdicts across an unrelated edit

- **Files.** New `packages/stryker-js/tests/workspace-package-exports-reuse.integration.test.ts`.
- **Scenarios.** AE1-AE3 as one outline over runner and `exports` shape.
- **Two-sided proof.** Built from `origin/main` the nested, array and `null`-beside-valid rows fail and the flat control passes; built from the head every row passes. The root-conditions row fails on the first-value build of `14a06fdab`.

### U4. A runtime-only edit re-tests on every runner

- **Files.** `packages/stryker-js/tests/__fixtures__/closure-only-runner/` (new on-disk runner plugin that reports one passing test and no `testFileModules`); the runtime-edit outline in U3's suite.
- **Scenarios.** AE5: nested `types`-first on the `vm` runner, and nested `types`-first, flat `types`-first and root conditions on the `closure-only` runner.
- **Two-sided proof.** Built from `14a06fdab` (first-value rule), the closure-only nested and flat `types`-first rows reuse stale verdicts and fail; built from the head every row passes.

## Verification Contract

- `pnpm --filter @systemfsoftware/stryker-js typecheck`, `lint`, `lint:tsgo`, and the package's full `test`.
- Build `@systemfsoftware/stryker-js` (`--concurrency=1`) before each built-CLI run; the baseline build is never taken from the head.
- `./bin/dprint check`.
- No local mutation. Survivors on `main` (run 38333841605) in `select-manifest-target.workflow.ts` are `bf8fc33bfe874ae6`, `c1c49ef7599681d9`, `f00516bf7f032d1a` and `ecd4fec1e600291a`, all in `patternMatchOf`, which this PR leaves alone. The new reader's mutants get their first grade on the next `main` Mutation run.
- Turbo rule: non-applicable. The diff adds tests, a test fixture and changes sources in an existing package; no CI task scope or cache input changes.

## Definition of Done

- U1-U4 in one PR off `origin/main`, with a patch changeset for `@systemfsoftware/stryker-js`.
- The lesson records the runtime-condition rule and its closure-only gate.
- CI is green on the PR's exact head, except Bench's inherited budget aborts.
- The PR body carries the two-sided results, the review receipt and every finding's disposition, with the schema-laws exception held for the root's ruling.
