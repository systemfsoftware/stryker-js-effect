---
title: Manifest exports the resolver cannot read stop making the whole package.json unreadable - Plan
type: fix
date: 2026-10-13
supersedes: docs/plans/2026-10-13-0620-fix-manifest-exports-decode-plan.md
topic: manifest-exports-decode
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Manifest Exports Decode - Plan

## Goal Capsule

- **Objective.** A project that links a workspace package whose `package.json` declares `exports` in any shape Node accepts keeps its verdicts across an edit no test reaches, and re-tests them after an edit to the file the runtime loads.
- **Means.** Decode every manifest key the resolver reads into a tagged entry Type that has a variant for every JSON shape, and choose the target inside the pure decision by the entry's tag, resolving each condition object to the file the runtime loads (KTD1, KTD2).
- **Authority.** Conductor intent r41 (`.rulings/stream-d-r41-manifest-exports-intent.md`) as clarified by r46 (`.rulings/stream-d-r46-pr330-debate.md`) and the root's r49 ruling on the schema (`.rulings/stream-d-r51b-prompt.md:3-6`) > this plan > the repo's packs and `CONSTITUTION.md`.
- **Stop.** One PR off `origin/main` (#330), green on its exact head, with a patch changeset for `@systemfsoftware/stryker-js`, the review receipt and per-finding dispositions in its body.
- **Why superseded.** The 0620 plan shipped string-target validity in `e8393042d`. The full-path review of that head (run `20261013-063937-1f11f4b8`) confirmed two P2s and one pack violation. (1) A condition object with an array-index key was read as conditions, where Node refuses it with `ERR_INVALID_PACKAGE_CONFIG` (`resolve.js:522-530`); that error is not `ERR_INVALID_PACKAGE_TARGET`, so inside an array it ends the resolution instead of being skipped (`:501-506`). (2) A non-string `main` fell through to `module`, which Node never reads; on `main` such a manifest failed to decode, so the PR had turned an open closure into one closed over a file Node does not load. (3) schema-laws `tests-own-no-schemas`: the differential spec's probe schemas sat in `tests/__fixtures__/node-resolution.schema.ts`. KTD2, R4, U2 and U5 change with them. The lineage (0606, 0546, 0519, 0441, 0239) never reached `main`; this plan replaces 0620 in this PR.

## Product Contract

### Summary

The import closure decides which files a test file depends on. Incremental runs reuse a mutant's verdict while the closures of its covering tests stay the same. For a workspace-linked package, the closure reads that package's `package.json` to map an import to a file. On `main`, one `exports` shape outside a two-level, string-only grammar fails the decode of the whole file, so every import of that package opens its closure and reuse stops for every test that imports it.

### Requirements

- R1. A linked package whose `exports` holds nested condition objects, array fallbacks, root conditions without a `.` key, or `null` targets resolves its imports, so an edit to a file no test reaches leaves every verdict reused. Observable as the second run's `reuse` event: `ran` is 0 and no refusal counts a mutant.
- R2. A manifest key whose value the resolver cannot interpret affects only the requests that read that key's entry. It never refuses the other keys or the rest of the file. This holds for `exports`, `imports`, `main` and `module`.
- R3. Every specifier resolves to the file the runtime loads, or leaves its importers' closures open; never to a file no runtime loads. Every `#` import and node builtin that #308 closed stays closed.
- R4. An entry the resolver cannot map (a `null` target, an empty array, an array none of whose elements yields a file once one of them is `null` or an invalid target, a condition branch ending in `null` or a number or boolean, a condition object no condition of Node's matches, a condition object with an array-index key at any depth, a non-string `main` (then `module` is not read), or an entry whose ESM and CommonJS importers load different files) yields no target, and that is final: no pattern and no `main`/`module` rescues it. So the closures that import it stay open.
- R5. Exit codes, log lines, report files and stream lines are unchanged for projects without the bug.

### Acceptance Examples

- AE1 (R1). A project links `@fixture/lib` whose `exports` is `{".": {"import": {"types": "./dist/index.d.ts", "default": "./dist/index.js"}}}`, the shape r41 names. Run 1 tests every mutant. A file no test imports is edited. Run 2 exits 0, and its `reuse` event reports `ran: 0` and `reused` equal to run 1's tested count, with every refusal 0.
- AE2 (R1). The same with `exports` `{".": ["./dist/index.js"]}`, `["./dist/index.js"]`, `{".": "./dist/index.js", "./internal/*": null}`, and, on a runner that reports no loaded modules, `{".": {"types": ..., "default": ...}}` and root conditions `{"types": ..., "import": ...}`.
- AE3 (R1, control). The same with flat `exports` `{".": "./dist/index.js"}`. This passes on `main` today, which shows the harness measures the bug rather than its own setup.
- AE4 (R4). Proven by U2's laws only. `main` already keeps such closures open (the whole manifest fails), so a CLI scenario could not fail there.
- AE5 (R3). A `types`-first package (nested and flat) on a runner that reports no loaded modules: only the package's `.js` changes between the runs, and run 2 tests again every mutant run 1 tested, refusing reuse for `closureChanged`. The same on the Vitest-backed `vm` runner, which reports loaded modules. A package with `import` then `require` branches, required by its test file, on the runner that reports no loaded modules: only its `.cjs` changes, and run 2 tests again every mutant.

### Scope Boundaries

- The condition rule: `@systemfsoftware/source` first (the workspace's own condition); otherwise the entry is read twice, as Node reads it, under the ESM set (`import`, `node`, `module-sync`, `node-addons`, `default`) and the CommonJS set (`require`, `node`, `module-sync`, `node-addons`, `default`): in each, the first key in object order that the set matches decides, and every other key (`types`, `browser`, `module`, `development`, user conditions) is skipped. The entry yields a target when both reads yield the same file, or when one yields a file and the other none; when they yield different files it yields none, because the scanner sends `require()` and `import` specifiers through one request and a runner that compiles `import` syntax to CommonJS takes the `require` branch, so the static reader cannot know which file loads.
- Array fallbacks follow Node's implementation (`resolve.js:488-520`) for the shapes the reader decodes: the first element yielding a file wins; `null`, a number or boolean, and an object no condition matches are skipped; with no file, the array yields none if it is empty or any element was `null` or an invalid target, and does not decide (the parent object reads its next condition) when every element matched no condition. A string Node rejects as a target (KTD2) is skipped the way Node skips it. Percent-encoded segments (`%2e%2e`) are not recognised as invalid; such a target names a directory that does not exist, so its closure stays open where Node would read the next element: slow, never stale.
- Not here: Stream B's reuse suites (`plan-stream-location`, `incremental-reuse`, `lockfile-closure-digest` and the others). A new suite is added instead.
- In scope since r49: schema-laws `rich-type-over-foreign-encoded`. The root ruled that it and the workflow-only mutation ruling do not conflict (`.rulings/stream-d-r51b-prompt.md:3-6`): the codec is graded by its generated laws and the target choice by mutation, so no exception is recorded.

### Sources

- `packages/stryker-js/src/import-closure.schema.ts` on `main`: `ExportEntrySchema` and the `exports` union; `imports` already `S.Json` (#308).
- `packages/stryker-js/src/import-closure.cell.ts`: `manifestOf` maps a failed decode to `undefined`, and `manifestTargetOf` maps `undefined` to `ManifestTargetMissing`; a chosen target becomes a member only if a candidate file exists; otherwise the resolution is `Unresolved`.
- `packages/stryker-js-cli-contract/src/run-event.schema.ts`: `ReuseRefusals` and the `reuse` event a run prints on stdout in machine mode.
- Node `doc/api/packages.md`, "Conditional exports" and "Community Conditions Definitions": Node matches conditions in key order against `node`, `import`, `require`, `module-sync`, `node-addons`, `default` and user conditions, and never `types`; an `exports` object with no `.`-prefixed key is sugar for `{".": {...}}`, and mixing both kinds of key is an invalid package configuration.
- Node `doc/api/esm.md`, resolution algorithm: `PACKAGE_RESOLVE` uses `exports` only when it "is not null or undefined".
- Node `lib/internal/modules/esm/resolve.js` (v24.x) `resolvePackageTarget`, `:482-548`: `[]` returns `null` (`:489-491`); an array element that throws `ERR_INVALID_PACKAGE_TARGET`, returns `undefined` or returns `null` is skipped (`:501-514`); with no resolved element the array returns `undefined` only when every element returned `undefined`, else `null` or the last error (`:517-520`); an object returns its first matched condition whose result is not `undefined` (`:531-542`). Where `esm.md`'s prose reads as an array returning on `null`, the implementation is what loads the file, and U5 pins it.
- `CompleteDryRunResult.testFileModules` (plugin interface): only the Vitest runner reports it; `analyzeImportClosure` adds each observed module to its test file's closure.
- `docs/solutions/performance-issues/strict-optional-key-in-a-third-party-manifest-schema-refuses-the-whole-manifest.md`: the rule this unit completes.

## Planning Contract

### Key Technical Decisions

- KTD1. **`PackageManifestSchema` keeps the foreign `package.json` as its Encoded side and decodes `exports`, `imports`, `main` and `module` into `PackageEntryField`** (r49). `PackageEntry` is a tagged tree with one variant per JSON shape: `EntryPath` (string), `EntryFallbacks` (array), `EntryMap` (object, key order kept), `EntryNull` and `EntryScalar` (number or boolean); an absent key is `EntryUndeclared`. The decode is total over JSON, so the manifest fails only when `package.json` is not a JSON object, and the generated round-trip, encode-stability and recursion laws grade the codec from the Type side. The schema holds no target choice: which condition, which fallback and which key form counts all stay in `selectManifestTarget`. `ExportEntrySchema` and its type are deleted along with their production uses. Rejected:
  - `S.optionalKey(S.Json)` with the grammar read inside the decision (this plan's first KTD1). It keeps the producer's raw shape as the domain type, against `rich-type-over-foreign-encoded` rule 2.
  - Widening the `exports` schema to Node's grammar (only the shapes Node accepts). It refuses the whole file on any shape outside the grammar, which is the defect the lesson records, and it moves the decision of what Node accepts into the codec, which mutation does not grade.
  - Widening `exports` only. It leaves `main`/`module` able to refuse the file, against the rule the lesson records.
- KTD2. **One entry reader serves `exports` and `imports` at any depth, a present entry is final, and a condition object follows the runtime.**
  - Reading an entry:
    - a string is the target when Node accepts it as one (`resolve.js:389-423`): in `exports`, it starts with `./` and has no `.`, `..` or `node_modules` segment after it; in `imports`, a `./` string the same way, or a bare package specifier (not empty, not starting with `.`, `/` or `#`); any other string decides that no target loads, and inside an array it is skipped;
    - an array yields its first element that yields a file, read again by the same reader; with none, it yields none when it is empty or an element was `null` or a number or boolean, and does not decide when every element matched no condition;
    - an object yields its `@systemfsoftware/source` value if present; otherwise its first key in the read's condition set, read again by the same reader; with no such key it does not decide;
    - `null` and a number or boolean decide that no target loads (inside an array they are skipped, as above);
    - an object with an array-index key (`0`, `1`, …) refuses the whole read, as Node's `ERR_INVALID_PACKAGE_CONFIG` does: the reader carries the refusal in a failure channel, so an object returns it, an array stops at it instead of skipping it, and the entry yields no target.
  - Every entry is read under the ESM set and the CommonJS set. Both yield the same file, or one a file and the other none: that file. Different files, or none in both: no target.
  - A top-level `exports` string or array is the root entry. A top-level `exports` object with no `.`-prefixed key is the root's conditions; one mixing `.`-prefixed and other keys yields no target. A top-level `null` counts as absent, as in Node, so `main`/`module` apply. For the root fallback, a string `main` is the target; a present non-string `main` yields no target; `module` is read only when `main` is absent.
  - Lookup separates "no entry for this request" from "an entry that yields no target":
    - **No entry:** no exact key and no matching pattern. Patterns, then `main`/`module` for the root.
    - **An entry that yields no target:** `ManifestTargetMissing`, with no pattern and no `main` consulted (R4).

  Rejected:
  - The first-value rule (the 0239 plan's choice). It closes a `types`-first object over a `.d.ts` no runtime loads; the review's confirmed P1.
  - Skipping `require` as never active. A CommonJS importer loads that branch, and the request does not carry the importer's syntax, so the closure stays open instead.
  - Letting the first key past `types` decide, with `import` followed only when no later key serves CommonJS (this plan's first draft). Node skips a condition it does not match, so `{ "module": …, "default": … }` loads `default`; the draft left it open, and its key test duplicated what reading under the CommonJS set states directly.
  - Following `import` whatever its siblings (0519's rule). The scanner sends `require()` and `import` specifiers through one request (`extract-module-specifiers.workflow.ts` `isRequireCall`), so a CommonJS importer of `{ import, require }` closed over the ESM file; the review's confirmed P2.
  - Carrying the importer's syntax on the request. The source syntax does not fix the runtime's condition set: a runner that compiles `import` syntax to CommonJS loads the `require` branch, so the reader still cannot know which branch runs.
  - Keeping a declaration-only choice open while keeping first-value elsewhere (r46's minimal alternative). It still closes flat `{types, default}` on the `.d.ts`, the same stale path.
  - Ending an array at its first `null` (0546's rule, and this bullet's former claim that Node returns `null` as blocked). Node's implementation skips it (`resolve.js:511-514`).
  - Pinning Node with a known-answer table in the laws. A table restates what the author believes Node does, and that belief was wrong twice here; U5 asks Node.
  - Falling through to patterns or `main` when an entry yields no target. That closes the closure on a file Node never loads.
  - Treating an array-index object as an unmatched or blocked element (`e8393042d`). Node rethrows its `ERR_INVALID_PACKAGE_CONFIG` inside an array, so a later element must not be read.
  - Letting a non-string `main` fall through to `module` (`e8393042d` and before). Node ignores such a `main` and never reads `module`; the closure must stay open, as it did on `main`.
  - Judging a string only after the target is chosen (`mapPathTargetOf`, 0606 and before). An array then stops at a string Node skips, and an `exports` string without `./` became a path target; U5 shrank that to `"/a.js"`.
- KTD3. **The user-observable test drives the built CLI.** `node dist/main.mjs run` runs twice on a temporary repo, with an edit between the runs, and the test reads only the exit codes and the `reuse` line of stdout. The `vm` runner reports the modules each test loaded, which can hide a stale static closure, so AE5 and the closure-only rows of AE2 use an on-disk runner fixture, `closure-only`, that reports no `testFileModules` (the on-disk runner pattern `dry-run-failure.integration.test.ts` uses).

### Plan Gates (plan-discipline rule)

- **Test-layer admission (`test-layer-selection`, `architect-property-tests` rule).** U2's laws draw the production `ManifestTargetCommand` schema and state relations over values derived from the draw. U3/U4 spawn the built CLI, which the skill's in-process gate refuses, but conductor intent r41 ("Ryan's rule") requires exactly this test and outranks the skill; the conflict is recorded here.
- **Wiki probe.** `software-wiki` returned no document on reading `package.json` `exports`, nor on decoding a foreign document into a total tagged union.
- **Web probe.** Node's packages and ESM resolution documents (Sources). `PACKAGE_TARGET_RESOLVE` (Node `doc/api/esm.md`) branches on exactly these target kinds: a string, an array (it loops past invalid targets, `null` and unmatched elements; Sources), a conditions object and `null`; anything else is an Invalid Package Target. KTD1's variants are those kinds, plus `EntryScalar` for the invalid numbers and booleans.
- **Destructive review: assumptions it breaks.**
  - "First value is a safe approximation at any depth." It is not when the first branch is one no runtime takes (`types`); KTD2 now follows the runtime.
  - "A runner's observed modules make the static closure's file choice harmless." Only the Vitest runner reports them; KTD3 adds a runner that does not.
  - "An entry that yields nothing can fall back." It cannot: Node never falls back from a present entry.
  - "`import` is a runtime condition like `node`." It is not: only ESM importers match it, and a CommonJS importer of the same object takes a later branch.
  - "The first key past `types` decides." It does not: Node skips every key outside its condition set, so a `browser` or `module` branch first falls through to `default`.
  - "A schema over a foreign document must either refuse or stay raw JSON." It need not: a decode with one variant per JSON shape is total, so the Type can be rich without refusing a file the reader could still use (KTD1).

### Sequencing

U1 → U2 → U3 → U4 → U5.

## Implementation Units

### U1. Manifest keys decode into tagged entries, entries read at any depth

- **Goal.** R1, R2, R4 at the decision.
- **Files.** `packages/stryker-js/src/import-closure.schema.ts`; `packages/stryker-js/src/select-manifest-target.workflow.ts`; `packages/stryker-js/src/__tests__/select-manifest-target.workflow.property.test.ts` (fixtures built through the production codec).
- **Approach.** KTD1 and KTD2. The decision dispatches exhaustively on the entry's tag. The lookup returns `Option<Option<string>>`: the outer layer says whether an entry exists, the inner one whether it yields a target. The laws keep writing manifests as `package.json` JSON and reach the decision through `PackageManifestSchema`, so they speak the grammar Node documents.

### U2. Laws for the decision

- **File.** `packages/stryker-js/src/__tests__/select-manifest-target.workflow.property.test.ts`.
- **Laws.** Each draws `ManifestTargetCommand`:
  - `∀c_ConditionChain_≡FirstRuntimeConditionPastTypesAtEveryDepthForExportsAndImports`;
  - `∀c_ConditionChain_≡UnmatchedConditionsFallThroughToTheFileEveryImporterLoads`;
  - `∀c_ConditionChain_≡MissingWhenEsmAndCommonJsImportersLoadDifferentFiles`;
  - `∀c_RootConditions_≡ReadAsTheRootEntryAndMissingBesideASubpathKey`;
  - `∀c_ConditionChain_≡SourceConditionBeforeEarlierKeysAtItsOwnDepth`;
  - `∀c_Fallbacks_≡FirstElementYieldingAFileWinsAndOnlyAllUnmatchedElementsFallThrough`;
  - `∀c_StringTargets_≡AnInvalidTargetYieldsNoneAloneAndIsSkippedInsideAnArray`;
  - `∀c_ConditionObject_≡AnArrayIndexKeyRefusesTheEntryEvenInsideAnArray`;
  - `∀c_RootEntry_≡MainDecidesTheRootOnlyWhenExportsDeclaresNone`;
  - `∀c_NullExports_≡ReadAsIfExportsWereAbsent`;
  - `∀c_ExactEntry_≡DecidesAloneWhateverPatternSitsBesideIt`;
  - `∀c_MainOrModule_≡ANonStringMainYieldsNoneAndModuleCountsOnlyWithoutMain`.
- **Evidence.** The first-value decision of `14a06fdab` fails the condition-chain and root-conditions laws; the rest failed against `main`'s decision when added. The two-condition-set decision fails three laws on `07f55c9f9`, its parent: the fall-through, the ESM/CommonJS and the fallbacks laws. The fallbacks law fails on `72410ddba` (0546's array rule), and the string-targets law on `3eee2a48c` (0606's string rule); the array-index and main/module laws fail on `e8393042d`. All pass on the head.

### U3. The built CLI keeps verdicts across an unrelated edit

- **Files.** New `packages/stryker-js/tests/workspace-package-exports-reuse.integration.test.ts`.
- **Scenarios.** AE1-AE3 as one outline over runner and `exports` shape.
- **Two-sided proof.** Built from `origin/main` the nested, array and `null`-beside-valid rows fail and the flat control passes; built from the head every row passes. The root-conditions row fails on the first-value build of `14a06fdab`.

### U4. A runtime-only edit re-tests on every runner

- **Files.** `packages/stryker-js/tests/__fixtures__/closure-only-runner/` (new on-disk runner plugin that reports one passing test and no `testFileModules`); the runtime-edit outline in U3's suite.
- **Scenarios.** AE5: nested `types`-first on the `vm` runner, and nested `types`-first, flat `types`-first and root conditions on the `closure-only` runner; and the dual `import`/`require` package required through `createRequire` on the `closure-only` runner, editing only its `.cjs`.
- **Two-sided proof.** Built from `14a06fdab` (first-value rule), the closure-only nested and flat `types`-first rows reuse stale verdicts and fail; built from `07f55c9f9` (`import` followed whatever its siblings), the dual-package scenario reuses 2 stale verdicts and fails, as do the laws `∀c_ConditionChain_≡MissingWhenEsmAndCommonJsImportersLoadDifferentFiles` and `∀c_ConditionChain_≡UnmatchedConditionsFallThroughToTheFileEveryImporterLoads`; built from the head every row and law passes.

### U5. The import closure agrees with Node's resolver

- **Goal.** R3 and R4 pinned against the runtime (boundary-testing `pin-dependency-semantics`).
- **Files.** New `packages/stryker-js/tests/manifest-target-node-resolution.differential.test.ts` and the reference harness `packages/stryker-js/tests/__fixtures__/node-resolution.fixture.ts` (probe source, its output decode and the `node` run; harness schemas stay unexported there, per schema-laws `tests-own-no-schemas` rule 3).
- **Approach.** `Differential.compare` (`@systemfsoftware/differential-spec`, already a devDependency). Input: two generated entry trees, one for a linked package's `exports` subpath and one for the project's `imports` key, over the strings `./a.js`, `./b.js`, `./c.cjs`, the rejected targets `/a.js`, `../a.js`, `./x/../a.js` and `./node_modules/a.js`, plus `a.js` for `exports` only (in `imports` it names a package, which Node tries to load and whose absence ends an array with an error), `null`, a number, a boolean, arrays and condition objects keyed by `types`, `import`, `require`, `node`, `module-sync`, `node-addons`, `default`, `browser`, `module`, `development` and the array index `0`. Reference: a real `node` process resolves both specifiers with `import.meta.resolve` and `require.resolve` against the package written to disk. Candidate: `ImportClosure.analyzeImportClosure` over the same project, through the public barrel. Oracle: from Node's ESM and CommonJS answers, the file both agree on (or the one answer when the other is none), else open; it must equal the closure's outcome exactly. Host-bound lane (temp directories, a child process); `runBudget` 100.
- **Out of its program space.** Percent-encoded segments, bare package targets in `imports`, pattern keys, `@systemfsoftware/source` and the `main`/`module` fallback; the laws own those.
- **Two-sided proof.** On `07f55c9f9` it fails, shrunk to `imports` `{ "require": "./a.js", "types": "./a.js" }` (Node's CommonJS side loads `a.js`; the closure stayed open). On `72410ddba` it fails, shrunk to `{ "module-sync": [], "node": "./a.js" }` (Node blocks; the closure closed on `a.js`). On `3eee2a48c`, once the generator draws rejected strings, it fails, shrunk to `exports` `"/a.js"` (Node rejects it; the closure closed on `pkgs/lib/a.js`). On `e8393042d`, once the generator draws the key `0`, it fails, shrunk to an `imports` object holding `"0"` (Node refuses it in both module systems; the closure closed on `a.js`). It passes on the head.

## Verification Contract

- `pnpm --filter @systemfsoftware/stryker-js typecheck`, `lint`, `lint:tsgo`, and the package's full `test`.
- Build `@systemfsoftware/stryker-js` (`--concurrency=1`) before each built-CLI run; the baseline build is never taken from the head.
- `./bin/dprint check`.
- No local mutation. Survivors on `main` (run 38349712161, `add57742a`) in `select-manifest-target.workflow.ts` are `bf8fc33bfe874ae6`, `c1c49ef7599681d9`, `f00516bf7f032d1a` and `ecd4fec1e600291a`, all in `patternMatchOf`, which this PR leaves alone. The new reader's mutants get their first grade on the next `main` Mutation run.
- Turbo rule: non-applicable. The diff adds tests, a test fixture and changes sources in an existing package; no CI task scope or cache input changes.

## Definition of Done

- U1-U5 in one PR off `origin/main`, with a patch changeset for `@systemfsoftware/stryker-js`.
- The lesson records the runtime-condition rule and its closure-only gate.
- CI is green on the PR's exact head, except Bench's inherited budget aborts.
- The PR body carries the two-sided results, the review receipt and every finding's disposition, each row naming its fixing commit.
