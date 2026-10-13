---
title: Manifest exports the resolver cannot read stop making the whole package.json unreadable - Plan
type: fix
date: 2026-10-13
supersedes: docs/plans/2026-10-13-0230-fix-manifest-exports-decode-plan.md
topic: manifest-exports-decode
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Manifest Exports Decode - Plan

## Goal Capsule

- **Objective.** A project that links a workspace package whose `package.json` declares `exports` in any shape Node accepts keeps its verdicts across an edit no test reaches: the second `stryker run` reuses every prior verdict, as it already does for a package with flat `exports`.
- **Means.** Decode every manifest key the resolver reads as plain JSON and interpret entries inside the pure decision (KTD1, KTD2).
- **Authority.** Conductor intent r41 (`.rulings/stream-d-r41-manifest-exports-intent.md`) > this plan > the repo's packs and `CONSTITUTION.md`.
- **Stop.** One PR off `origin/main`, green on its exact head, with a patch changeset for `@systemfsoftware/stryker-js`, the review receipt and per-finding dispositions in its body.
- **Why superseded.** U1 and U2 had started when the report-only document review found that a root entry yielding no target fell through to `main`, a file Node never loads. KTD2 now makes such an entry terminal. AE4, U1's file list and U2's law list change with it; the earlier plan is replaced.

## Product Contract

### Summary

The import closure decides which files a test file depends on. Incremental runs reuse a mutant's verdict while the closures of its covering tests stay the same. For a workspace-linked package, the closure reads that package's `package.json` to map an import to a file. Today one `exports` shape outside a two-level, string-only grammar fails the decode of the whole file, so every import of that package opens its closure and reuse stops for every test that imports it.

### Requirements

- R1. A linked package whose `exports` holds nested condition objects, array fallbacks or `null` targets resolves its imports, so an edit to a file no test reaches leaves every verdict reused. Observable as the second run's `reuse` event: `ran` is 0 and no refusal counts a mutant.
- R2. A manifest key whose value the resolver cannot interpret affects only the requests that read that key's entry. It never refuses the other keys or the rest of the file. This holds for `exports`, `imports`, `main` and `module`.
- R3. Every specifier Node can load resolves to the same file as today. Every `#` import and node builtin that #308 closed stays closed.
- R4. An entry the resolver cannot map (a `null` target, an array whose first element is `null`, a condition branch ending in `null`) yields no target, and that is final: no pattern and no `main`/`module` rescues it. So the closures that import it stay open.
- R5. Exit codes, log lines, report files and stream lines are unchanged for projects without the bug.

### Acceptance Examples

- AE1 (R1). A project links `@fixture/lib` whose `exports` is `{".": {"import": {"types": "./dist/index.d.ts", "default": "./dist/index.js"}}}`, the shape r41 names. Run 1 tests every mutant. A file no test imports is edited. Run 2 exits 0, and its `reuse` event reports `ran: 0` and `reused` equal to run 1's tested count, with every refusal 0.
- AE2 (R1). The same with `exports` `{".": ["./dist/index.js"]}` and with `{".": "./dist/index.js", "./internal/*": null}`.
- AE3 (R3, control). The same with flat `exports` `{".": "./dist/index.js"}`. This passes on `main` today, which shows the harness measures the bug rather than its own setup.
- AE4 (R4). Proven by U2's laws only. `main` already keeps such closures open (the whole manifest fails), so a CLI scenario could not fail there.

### Scope Boundaries

- The condition rule itself stays: the `@systemfsoftware/source` condition, else the first listed value (`select-manifest-target.workflow.ts`, `entryTargetOfEntry`). KTD2 only applies it at every depth.
- Not here: matching Node's runtime condition set. See OQ1.
- Not here: Stream B's reuse suites (`plan-stream-location`, `incremental-reuse`, `lockfile-closure-digest` and the others). A new suite is added instead.

### Outstanding Questions (deferred, not blocking)

- OQ1. The first-value rule picks a `types` condition when it is listed first, as TypeScript's documentation recommends. The closure then follows the `.d.ts` file, not the runtime `.js`, so an implementation-only rebuild that leaves the declarations untouched would not move the digest. This predates the unit for flat condition objects, and KTD2 extends it to nested ones. Fixing it moves flat packages to a different file, which R3 forbids without a ruling. It is reported to the conductor as a separate decision.

### Sources

- `packages/stryker-js/src/import-closure.schema.ts:32-40` on `main`: `ExportEntrySchema` and the `exports` union; `imports` already `S.Json` (#308).
- `packages/stryker-js/src/import-closure.cell.ts:305-312` (`manifestOf` maps a failed decode to `undefined`) and `:314-323` (`manifestTargetOf` maps `undefined` to `ManifestTargetMissing`).
- `packages/stryker-js/src/import-closure.cell.ts:265-274`: a chosen target becomes a member only if a candidate file exists; otherwise the resolution is `Unresolved`.
- `packages/stryker-js-cli-contract/src/run-event.schema.ts:32-43,344-348`: `ReuseRefusals` and the `reuse` event a run prints on stdout in machine mode.
- Node `doc/api/esm.md`, resolution algorithm: `PACKAGE_RESOLVE` uses `exports` only when it "is not null or undefined"; in `PACKAGE_TARGET_RESOLVE`, an array continues only on an invalid target or `undefined`, and `null` returns `null`.
- `docs/solutions/performance-issues/strict-optional-key-in-a-third-party-manifest-schema-refuses-the-whole-manifest.md`: the rule this unit completes.

## Planning Contract

### Key Technical Decisions

- KTD1. **`PackageManifestSchema` declares `exports`, `imports`, `main` and `module` as `S.optionalKey(S.Json)`.** The decode then fails only when `package.json` is not a JSON object. `main` and `module` are read as targets only when they are strings. `ExportEntrySchema` and its type are deleted along with their production uses; the property test's `EntryMap` alias becomes `S.Json` (U1). Rejected:
  - Widening the `exports` schema to Node's grammar with a recursive `S.suspend` union. It still refuses the whole file on any shape outside the grammar, and it duplicates in the schema the reading the decision already does.
  - Widening `exports` only. It leaves `main`/`module` able to refuse the file, against the rule the lesson records.
- KTD2. **One entry reader serves `exports` and `imports` at any depth, and a present entry is final.**
  - Reading an entry:
    - a string is the target;
    - an array yields its first element, read again by the same reader;
    - an object yields its `@systemfsoftware/source` value if present, else its first value, read again by the same reader;
    - `null` and every other value yield none.
  - A top-level `exports` string or array is the root entry. A top-level `null` counts as absent, as in Node, so `main`/`module` apply.
  - Lookup separates "no entry for this request" from "an entry that yields no target":
    - **No entry:** no exact key and no matching pattern. Today's path applies: patterns, then `main`/`module` for the root.
    - **An entry that yields no target:** `ManifestTargetMissing`, with no pattern and no `main` consulted (R4).
  - At depth one, for every entry that yields a target, this is today's rule exactly.
  - The resolutions that change are those Node refuses at runtime, so no passing suite can depend on them:
    - an exact `imports` key mapped to `null` beside a matching pattern;
    - a root `exports` entry that maps nowhere (`{".": {}}`) beside a `main`.

  Rejected:
  - Node's runtime condition set (`import`, `node`, `default`, skipping `types`). It moves flat `{types, default}` packages to a different file (R3; OQ1).
  - An array yielding its first element that yields a target. That skips `null`, which Node returns as blocked.
  - Falling through to patterns or `main` when an entry yields no target. That closes the closure on a file Node never loads (document review, adversarial P1).
- KTD3. **The user-observable test drives the built CLI.** `node dist/main.mjs run` runs twice on a temporary repo through the `vm` (vitest) runner, with an edit between the runs to a module no test imports and no `mutate` pattern covers. The test reads only the exit codes and the `reuse` line of stdout. It follows the spawn shape of the existing built-CLI suites (`plan-stream-location.integration.test.ts`) and imports no engine cell.

### Assumptions

- A1. Vitest resolves the fixture's nested, array and `null`-beside-valid `exports` at runtime. Checked when U3 first runs; if it does not, that shape leaves AE2 and this is reported.

### Plan Gates (plan-discipline rule)

- **Test-layer admission (`test-layer-selection`, `architect-property-tests` rule).**
  - U2's laws draw the production `ManifestTargetCommand` schema and state metamorphic relations over its drawn `S.Json` values. No constant tables are used. Admitted.
  - The in-source "the manifest decodes any JSON" law of the earlier plan restated the generated codec round-trip law, so it is dropped.
  - U3 spawns the built CLI. The skill's in-process gate refuses process-spawning integration tests, but conductor intent r41 ("Ryan's rule") requires exactly this test, and the intent outranks the skill. The repo already carries such suites. Admitted under r41, and the conflict is recorded here.
- **Wiki probe.** `software-wiki` returned no document on reading `package.json` `exports`.
- **Web probe.** Node's ESM resolution algorithm (Sources). It set the array rule and the top-level `null` rule.
- **Destructive review: assumptions it breaks.**
  - "First value is a safe approximation at any depth." It is not when the first branch is one Node never takes at runtime (`types`, `browser`, `worker`); OQ1.
  - "An entry that yields nothing can fall back." It cannot: Node never falls back from a present entry, so KTD2 makes it terminal.
  - "Vitest runs the fixture shapes" (A1). Checked at U3.
  - Radical alternative: delegate to Node's resolver (`import.meta.resolve` under the runner's conditions). Rejected for this unit: the runner's conditions are vitest's, not Node's default, and every flat package would move file (R3).

### Document Review Dispositions (report-only round on the superseded plan)

- Adversarial P1, root `null` falls back to `main`: accepted, KTD2.
- Adversarial P2, the two-sided proof needs `main` built separately: accepted, U3.
- Feasibility P2, AE1's types-first fixture follows the `.d.ts`: declined. AE1 is the shape r41 names, and it asserts the outcome a user sees; the soundness gap is OQ1, reported.
- Feasibility P2, a top-level `exports` array has no path: accepted, KTD2. Its suggestion that a top-level `null` yield a missing root is declined: Node treats `exports: null` as absent.
- Coherence P2, U1 omits the test file it breaks: accepted, U1.
- Coherence P2, AE4 cannot fail on `main`: accepted, AE4.
- Coherence P2, Scope Boundaries names a deleted symbol: accepted.

### Sequencing

U1 → U2 → U3.

## Implementation Units

### U1. Manifest keys decode as JSON, entries read at any depth

- **Goal.** R1–R4 at the decision.
- **Files.** `packages/stryker-js/src/import-closure.schema.ts`; `packages/stryker-js/src/select-manifest-target.workflow.ts`; `packages/stryker-js/src/__tests__/select-manifest-target.workflow.property.test.ts` (types only).
- **Approach.** KTD1 and KTD2. The lookup returns `Option<Option<string>>`: the outer layer says whether an entry exists, the inner one whether it yields a target.

### U2. Laws for the decision

- **File.** `packages/stryker-js/src/__tests__/select-manifest-target.workflow.property.test.ts`.
- **Laws.** Each draws `ManifestTargetCommand`, and each fails against `main`'s decision (U2 evidence below):
  - `∀c_ConditionChain_≡FirstValueAtEveryDepthForExportsAndImports`;
  - `∀c_ConditionChain_≡SourceConditionBeforeEarlierKeysAtItsOwnDepth`;
  - `∀c_Fallbacks_≡TheFirstElementDecidesWhateverFollows`;
  - `∀c_RootEntry_≡MainDecidesTheRootOnlyWhenExportsDeclaresNone`;
  - `∀c_NullExports_≡ReadAsIfExportsWereAbsent`;
  - `∀c_ExactEntry_≡DecidesAloneWhateverPatternSitsBesideIt`;
  - `∀c_NonStringMainOrModule_≡ReadAsIfTheKeyWereAbsent`.
- **Evidence.**
  - In a scratch worktree at `origin/main` (`/tmp/r41-main`), the first six fail against `main`'s decision.
  - The seventh is vacuous under `main`'s schema, which draws only string `main`/`module`. It fails against `main`'s decision when the head's schema draws non-string values.
  - All pass on the head.

### U3. The built CLI keeps verdicts across an unrelated edit

- **Files.** New `packages/stryker-js/tests/workspace-package-exports-reuse.integration.test.ts`.
- **Scenarios.** AE1–AE3, one scenario per `exports` shape.
- **Two-sided proof.**
  1. In the scratch worktree at `origin/main`, build with `pnpm exec turbo run build --filter=@systemfsoftware/stryker-js... --concurrency=1`, copy the new suite in, and run it: AE1 and AE2 fail and AE3 passes.
  2. Then build and run it on the head: all pass.
  3. Record both in the PR body. The baseline is never taken from the head's build.

## Verification Contract

- `pnpm --filter @systemfsoftware/stryker-js typecheck`, `lint`, `lint:tsgo`.
- `pnpm --filter @systemfsoftware/stryker-js exec vitest run src/__tests__/select-manifest-target.workflow.property.test.ts src/import-closure.schema.ts`.
- Build `@systemfsoftware/stryker-js...` (`--concurrency=1`), then run `tests/workspace-package-exports-reuse.integration.test.ts` and `tests/import-closure.integration.test.ts`. The second is #308's in-process suite, run as R3's regression gate and not edited.
- `./bin/dprint check`.
- No local mutation. Survivors on `main` (run 38333841605) in `select-manifest-target.workflow.ts` are `bf8fc33bfe874ae6`, `c1c49ef7599681d9`, `f00516bf7f032d1a` and `ecd4fec1e600291a`, all in `patternMatchOf`, which this unit leaves alone. The new reader's mutants get their first grade on the next `main` Mutation run.
- Turbo rule: non-applicable. The diff adds a test file and changes sources in an existing package; no CI task scope or cache input changes.

## Definition of Done

- U1–U3 in one PR off `origin/main`, with a patch changeset for `@systemfsoftware/stryker-js`.
- The lesson's "One instance remains" claim is updated to record this fix.
- CI is green on the PR's exact head, except Bench's inherited budget aborts.
- The PR body carries U3's before/after results, the review receipt and every finding's disposition.
