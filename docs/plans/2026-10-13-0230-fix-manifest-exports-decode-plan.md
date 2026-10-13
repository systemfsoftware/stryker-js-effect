---
title: Manifest exports the resolver cannot read stop making the whole package.json unreadable - Plan
type: fix
date: 2026-10-13
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

## Product Contract

### Summary

The import closure decides which files a test file depends on. Incremental runs reuse a mutant's verdict while the closures of its covering tests stay the same. For a workspace-linked package, the closure reads that package's `package.json` to map an import to a file. Today one `exports` shape outside a two-level, string-only grammar fails the decode of the whole file, so every import of that package opens its closure and reuse stops for every test that imports it.

### Requirements

- R1. A linked package whose `exports` holds nested condition objects, array fallbacks or `null` targets resolves its imports, so an edit to a file no test reaches leaves every verdict reused. Observable as the second run's `reuse` event: `ran` is 0 and no refusal counts a mutant.
- R2. A manifest key whose value the resolver cannot interpret affects only the requests that read that key's entry. It never refuses the other keys or the rest of the file. This holds for `exports`, `imports`, `main` and `module`.
- R3. Every package that resolves today resolves to the same file. Every `#` import and node builtin that #308 closed stays closed.
- R4. An entry the resolver cannot map (a `null` target, an array with no usable element, a condition branch ending in `null`) still yields no target, so the closures that import it stay open.
- R5. Exit codes, log lines, report files and stream lines are unchanged for projects without the bug.

### Acceptance Examples

- AE1 (R1). A project links `@fixture/lib` whose `exports` is `{".": {"import": {"types": "./dist/index.d.ts", "default": "./dist/index.js"}}}`. Run 1 tests every mutant. A file no test imports is edited. Run 2 exits 0 and its `reuse` event reports `ran: 0` and `reused` equal to run 1's tested count, with every refusal 0.
- AE2 (R1). The same with `exports` `{".": ["./dist/index.js"]}` and with `{".": "./dist/index.js", "./internal/*": null}`.
- AE3 (R3, control). The same with flat `exports` `{".": "./dist/index.js"}`. This passes on `main` today, so it shows the harness measures the bug and not its own setup.
- AE4 (R4). A test that also imports a subpath whose target is `null` keeps its closure open: run 2 re-runs that test's mutants and counts them under `closureChanged`. [Kept only if vitest runs such a test; the decision-level law in U2 covers R4 either way.]

### Scope Boundaries

- The condition rule itself stays: the `@systemfsoftware/source` condition, else the first listed value (`select-manifest-target.workflow.ts`, `conditionTargetOption`). KTD2 only applies it at every depth.
- Not here: matching Node's runtime condition set. See Outstanding Questions.
- Not here: Stream B's reuse suites (`plan-stream-location`, `incremental-reuse`, `lockfile-closure-digest` and the others); this plan adds a new suite instead.

### Outstanding Questions (deferred, not blocking)

- OQ1. The first-value rule picks a `types` condition when it is listed first, as TypeScript's documentation recommends. The closure then follows the `.d.ts` file, not the runtime `.js`, and an implementation-only rebuild that leaves the declarations untouched would not move the digest. This predates the unit for flat condition objects, and KTD2 extends it to nested ones. Fixing it moves flat packages to a different file, which R3 forbids without a ruling. It is reported to the conductor as a separate decision.

### Sources

- `packages/stryker-js/src/import-closure.schema.ts:32-40`: `ExportEntrySchema` and the `exports` union; `imports` already `S.Json` (#308).
- `packages/stryker-js/src/import-closure.cell.ts:305-312` (`manifestOf` maps a failed decode to `undefined`) and `:314-323` (`manifestTargetOf` maps `undefined` to `ManifestTargetMissing`).
- `packages/stryker-js/src/import-closure.cell.ts:265-274`: a chosen target becomes a member only if a candidate file exists; otherwise the resolution is `Unresolved`.
- `packages/stryker-js/src/select-manifest-target.workflow.ts`: `entryTargetOfEntry` and `conditionTargetOption` read one level; `exportsTargetOption` already takes `S.Json`.
- `packages/stryker-js-cli-contract/src/run-event.schema.ts:32-43,344-348`: `ReuseRefusals` and the `reuse` event a run prints on stdout in machine mode.
- `docs/solutions/performance-issues/strict-optional-key-in-a-third-party-manifest-schema-refuses-the-whole-manifest.md`: the rule this unit completes.

## Planning Contract

### Key Technical Decisions

- KTD1. **`PackageManifestSchema` declares `exports`, `imports`, `main` and `module` as `S.optionalKey(S.Json)`.** The decode then fails only when `package.json` is not a JSON object. `main` and `module` are read as targets only when they are strings. `ExportEntrySchema` and its type are deleted along with their only uses. Rejected:
  - Widening the `exports` schema to Node's grammar with a recursive `S.suspend` union. It still refuses the whole file on any shape outside the grammar, and it duplicates in the schema the reading the decision already does.
  - Widening `exports` only. It leaves `main`/`module` able to refuse the file, against the rule the lesson records.
- KTD2. **One entry reader serves `exports` and `imports` at any depth.** It works as follows:
  - a string is the target;
  - an array yields its first element, read again by the same reader, so `[null, "./x.js"]` yields none as Node's blocked `null` does;
  - an object yields its `@systemfsoftware/source` value if present, else its first value, each read again by the same reader;
  - `null` and every other value yield none.

  At depth one this is today's rule exactly, so R3 holds by construction. Rejected:
  - Node's runtime condition set (`import`, `node`, `default`, skipping `types`). It moves flat `{types, default}` packages to a different file (R3; OQ1).
  - An array yielding its first element that yields a target. That skips `null`, which Node returns as blocked rather than skipping. Node's `PACKAGE_TARGET_RESOLVE` continues an array only on an invalid target or an unmatched condition object (Node `doc/api/esm.md`, resolution algorithm), so a test would be refused at runtime while the closure called it closed (R4).
- KTD3. **The user-observable test drives the built CLI.** `node dist/main.mjs run` runs twice on a temporary repo through the `vm` (vitest) runner, with an edit between the runs to a module no test imports and no `mutate` pattern covers. The test reads only the exit codes and the `reuse` line of stdout. It follows the spawn shape of the existing built-CLI suites (`plan-stream-location.integration.test.ts`), and imports no engine cell.

### Assumptions

- A1. Vitest resolves the fixture's nested, array and `null`-beside-valid `exports` at runtime. Checked when U3 first runs; if it fails, the shape leaves AE2 and that is reported.

### Plan Gates (plan-discipline rule)

- **Test-layer admission (`test-layer-selection`).**
  - U2's laws are decision property tests beside the workflow and a schema law in the schema's own module: admitted.
  - U3 spawns the built CLI. The skill's in-process gate refuses process-spawning integration tests, but conductor intent r41 ("Ryan's rule") requires exactly this test, and the intent outranks the skill (Goal Capsule, authority). The repo already carries such suites, for example `plan-stream-location.integration.test.ts`. Admitted under r41, and the conflict is recorded here.
- **Wiki probe.** `software-wiki` returned no document on reading `package.json` `exports`.
- **Web probe.** Node's ESM resolution algorithm (`doc/api/esm.md`, `PACKAGE_TARGET_RESOLVE`): arrays continue only on invalid targets or `undefined`, `null` returns `null`, and condition objects take the first key in the active condition set. This changed KTD2's array rule.
- **Destructive review: assumptions it breaks.**
  - "First value is a safe approximation at any depth." It is not when the first branch is one Node never takes at runtime (`types`, `browser`, `worker`): the closure follows a file the test does not load. This holds for flat objects today; KTD2 extends it, and OQ1 carries it to the conductor.
  - "Decoding every key as JSON cannot regress anything." A manifest whose `main` is not a string used to fail as a whole, which opened its closures (sound). Now its other keys are read. Only closures over shapes the reader interprets close, so no closure closes on a target the reader cannot map (R4 laws).
  - "Vitest runs the fixture shapes" (A1). Checked at U3.
  - Radical alternative: delegate to Node's resolver (`import.meta.resolve` under the runner's conditions). Rejected for this unit: the runner's condition set is vitest's, not Node's default, and every flat package would move file (R3).

### Sequencing

U1 → U2 → U3. U3's scenarios are run on `origin/main`'s source first to show they fail, then on the head.

## Implementation Units

### U1. Manifest keys decode as JSON, entries read at any depth

- **Goal.** R1–R4 at the decision.
- **Files.** `packages/stryker-js/src/import-closure.schema.ts`; `packages/stryker-js/src/select-manifest-target.workflow.ts`.
- **Approach.** KTD1: the schema change and the deletions. KTD2: the recursive reader replaces `conditionTargetOption`/`entryTargetOfEntry`; `mainTargetOption` reads string values only.
- **Patterns.** `select-manifest-target.workflow.ts` already pattern-matches `S.Json` with `Match.when(Predicate.isString, …)`/`isEntryMap`. Use the same style for arrays (`Array.isArray` guard).
- **Test scenarios.** U2.

### U2. Laws for the decision and the decode

- **Files.** `packages/stryker-js/src/__tests__/select-manifest-target.workflow.property.test.ts` (laws beside the workflow), plus an in-source law in `import-closure.schema.ts`.
- **Laws, each able to fail on a plausible bug:**
  - ∀ a target and any chain of non-source condition keys wrapped around it, the export and the `#` import resolve to that target (fails if the reader stops at depth one).
  - ∀ depth, the source condition beats an earlier key at that depth (fails if the source lookup applies at the top only).
  - ∀ arrays, the first element decides: a first `null` yields missing even when a later element is a valid target, and a first valid target wins over later ones (fails on skip-null or last-wins readings).
  - ∀ `null` entry, that subpath is missing while a sibling subpath still resolves (R4 and R2 together).
  - ∀ JSON values in `exports`, `imports`, `main` and `module`, the manifest decodes (in-source, `import-closure.schema.ts`). This fails on `main`, where any non-grammar `exports` refuses the file.
  - ∀ non-string `main`/`module`, the root export falls back as if the key were absent.

### U3. The built CLI keeps verdicts across an unrelated edit

- **Files.** New `packages/stryker-js/tests/workspace-package-exports-reuse.integration.test.ts`.
- **Scenarios.** AE1–AE3 as one scenario per `exports` shape, plus AE4 if A1 holds for it.
- **Two-sided proof.** Build and run the suite against `origin/main`'s `src`, where AE1, AE2 and AE4's open half fail and AE3 passes, then against the head, where all pass. Record both in the PR body.

## Verification Contract

- `pnpm --filter @systemfsoftware/stryker-js typecheck`, `lint`, `lint:tsgo`.
- `pnpm --filter @systemfsoftware/stryker-js exec vitest run src/__tests__/select-manifest-target.workflow.property.test.ts src/import-closure.schema.ts`.
- `pnpm exec turbo run build --filter=@systemfsoftware/stryker-js... --concurrency=1`, then `pnpm --filter @systemfsoftware/stryker-js exec vitest run tests/workspace-package-exports-reuse.integration.test.ts tests/import-closure.integration.test.ts`. The second file is #308's in-process suite, run as a regression gate for R3; it is not edited.
- `./bin/dprint check`.
- No local mutation. Survivors on `main` (run 38333841605) in `select-manifest-target.workflow.ts` are `bf8fc33bfe874ae6`, `c1c49ef7599681d9`, `f00516bf7f032d1a` and `ecd4fec1e600291a`, all in `patternMatchOf` (`:72-76`), which this unit leaves alone. The new reader's mutants get their first grade on the next `main` Mutation run.
- Turbo rule: non-applicable. The diff adds a source file and a test file to an existing package and touches no CI task scope or cache input.

## Definition of Done

- U1–U3 merged in one PR off `origin/main` with a patch changeset for `@systemfsoftware/stryker-js`.
- The lesson's "One instance remains" claim is updated to record this fix.
- CI is green on the PR's exact head, except Bench's inherited budget aborts.
- The PR body carries U3's before/after results, the review receipt and every finding's disposition.
