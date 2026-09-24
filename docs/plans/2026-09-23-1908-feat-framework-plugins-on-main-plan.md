---
title: Framework Plugins over an Open Format Registry, on Main's Plugin System - Plan
type: feat
date: 2026-09-23
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
supersedes: docs/plans/2026-09-15-2043-feat-framework-plugin-architecture-plan.md
---

# Framework Plugins over an Open Format Registry, on Main's Plugin System - Plan

## Goal Capsule

- **Objective:** a TypeScript project with Angular templates (including `.vue` SFCs) or Svelte components runs mutation tests by installing the matching framework plugin package and listing it in `plugins`, the way every plugin is configured. The instrumenter core names no framework. A machine consumer reads the loaded framework contributions, the active format registry, and every skipped file from the NDJSON stream.
- **Means:** an in-process `strykerFrameworks` export of plain objects, read by the plugin loader in `packages/stryker-js` beside `strykerIgnorers`; a `packages/frameworks/{interface,angular,svelte}` family on the ignorer package template; the instrumenter rebuilt on the cell taxonomy over an open runtime format registry.
- **Branch:** PR #24 (`angular-svelete-plugins`). Its commits up to `53ac413` implemented this product on a base main has since replaced; those files are the reference implementation for the port. Main is merged into the branch, never rebased onto.
- **Authority:** `CONSTITUTION.md` > root `AGENTS.md` and scope `AGENTS.md` files > this plan. `.github/workflows/**`, `commitlint.config.ts`, `CONSTITUTION.md`, `subtrees.toml`, and `repos/**` are read-only. A gate that cannot go green without editing one of them stops the unit and is reported as an owner residual.
- **Stop conditions:** evidence that KTD1-KTD4 cannot work → stop and report. A parity pin failing without a named root cause → stop before deleting the old path.
- **Tail ownership:** publishing and npm trusted-publisher registration for the three debut names are human steps outside this plan.

---

## Product Contract

### Problem Frame

Main's instrumenter hardcodes Angular and Svelte: a closed `AstFormat` literal (`js|ts|tsx|html|svelte`) drives dispatch in `Parser.ts`, `Printer.ts`, `Transformer.ts`, and `Instrument.ts` (`packages/stryker-js-instrumenter/src/`), and the instrumenter depends on `angular-html-parser` and an optional `svelte` peer. No plugin can add a format. Main's plugin system (#29, #30) runs TestRunner, Checker, and Reporter plugins in worker processes, loads nothing by glob, and imports plugin modules in-process only to read plain `strykerIgnorers` objects and `strykerValidationSchema` (`packages/stryker-js/src/Plugins.ts`). The run stream (`packages/stryker-js/src/RunEvent.schema.ts`, `STREAM_SCHEMA_VERSION` `1.0`) says nothing about which formats are active or which files were skipped, and `determineLanguage` in `report-assembly.ts` labels a `.svelte` file `javascript`.

### Requirements

- R1. A framework plugin package contributes file-format support as an in-process `strykerFrameworks` export of plain objects typed only by `@systemfsoftware/stryker-framework-interface`. Each object carries a format claim (format id, extensions, report language label, owner version, contract version) and synchronous `parse`, `transform`, `print`, and `disableTypeChecks` hooks over a core-provided script toolkit. No Effect value and no `@systemfsoftware/stryker-js-*` import crosses the contract.
- R2. `@systemfsoftware/stryker-js-angular` claims `.html`, `.htm`, and `.vue` for an HTML-template format that instruments embedded script regions only, never template expressions. Signal-configuration ignoring stays in `@systemfsoftware/stryker-ignorer-angular`.
- R3. `@systemfsoftware/stryker-js-svelte` claims `.svelte`, owns the `svelte` optional peer (`>=3.30`, one constant shared with the runtime guard), resolves the compiler from the install when its module is evaluated, walks `>=5` ASTs with `oxc-walker`, and places the module-script instrumentation header only when mutants were placed.
- R4. Installing a framework package and adding it to `plugins` is the whole setup.
- R5. The instrumenter core supports js/ts/tsx natively and every other format through the runtime registry; no framework name, extension, or dependency remains in its sources or manifest.
- R6. The instrumenter pipeline is rebuilt on the cell taxonomy: pure decision workflows (format resolution, directive decoding and rule fold, mutant planning, mutant placement) inside cell sandwiches (instrument-files, disable-type-checks); the printer dispatches per node kind through `Match` with a named tolerant branch for unknown kinds; the mutable mutant collector and deep-freeze helpers are deleted.
- R7. A file whose extension no loaded format claims is skipped with a typed record (file, extension, reason) that reaches the stream; the reason names the package that claims the extension and says to add it to `plugins`. A claimed file that fails to parse fails the run with a typed error.
- R8. The run stream reports the loaded framework contributions per module, extension-claim shadowings (winner and loser), and the resolved registry (extension → format → owning module). New members ship with literal-oracle wire pins and a `STREAM_SCHEMA_VERSION` bump.
- R9. A framework that cannot serve refuses the run before instrumentation with a typed reason on `RunFailed`: `PeerMissing`, `PeerVersionUnsupported`, and `InvalidContribution` are ConfigError (exit 2); an import crash keeps main's InternalError (exit 4).
- R10. Report language labels come from the registry (`.svelte` reports `svelte`); the report `framework` field keeps its mutation-testing-report meaning (StrykerJS itself).
- R11. Incremental state records each file's format identity (format id, owning module, owner version); a mismatch or a missing identity on a claimed file recomputes that file's mutants; skipped files never enter incremental state.
- R12. The new packages follow main's family conventions: `packages/frameworks/*` workspace glob, the `@systemfsoftware/source` dev condition, the ignorer oxlint preset, api-extractor baselines from debut, catalog dependencies, scope `AGENTS.md`.
- R13. Breaking changes ship as major versions without shims; each affected published package's changeset and README name the removed built-in Angular/Svelte support and the replacement package.

### Key Decisions

- KD1. Framework support ships as plugins, not core code. Owner directive on PR #24.
- KD2. Breaking changes ship without compatibility shims. Owner directive on PR #24.
- KD3. Vue SFCs ride the HTML-template format in the Angular plugin (owner-approved on PR #24: preserves current `.vue` behavior with one fewer package).
- KD4. No framework authoring kit ships (owner-approved on PR #24: two first-party plugins are the contract test until a third-party author exists).

### Acceptance Examples

- AE1. **Given** `mutate` matches `.svelte` files and the Svelte plugin is not configured, **when** a machine-mode run executes, **then** it completes, the stream carries a skip record per file naming `.svelte`, the reason names `@systemfsoftware/stryker-js-svelte` and `plugins`, and the files are absent from results and incremental state.
- AE2. **Given** the Svelte plugin is configured and `svelte` is not installed, **when** the run loads plugins, **then** it refuses before instrumentation with `RunFailed` reason `PeerMissing` naming `svelte` and exit code 2.
- AE3. **Given** the Angular plugin is configured and a `.vue` file holds `<script lang="ts">` and `<template>` bindings, **when** it is instrumented, **then** mutants appear only inside the script region.

### Success Criteria

- A fixture project with only a framework fixture listed in `plugins` produces mutants from its claimed files through the in-process programmatic surface.
- Instrumenter `src/` and `package.json` contain zero case-insensitive `angular`, `svelte`, or `vue` matches.
- A machine consumer distinguishes framework-loaded, file-skipped, and run-refused from the stream alone.
- `pnpm check:ci` is green and the migrated Angular and Svelte scenarios pass in their plugin packages.
- Human-run review oracle (not committed): both plugin packages packed, installed into a scratch npm project beside the packed CLI, listed in `plugins`, and a run produces mutants for `.html`, `.vue`, `.svelte`, and `.ts` files while an unclaimed extension is skipped.

### Scope Boundaries

- Out: frameworks beyond Angular and Svelte; template-expression mutation; glob or zero-config discovery; worker-process framework plugins; a bundled signal ignorer in the Angular plugin; compile-checking of framework-file mutants by the TypeScript checker (their mutants stay strangers to its program, as today).
- Deferred: an e2e microVM journey installing packed framework plugins (`test/e2e`); mutation enrollment of the framework packages and new decision files (`.github/workflows/mutation.yml` is an owner surface, CONST-E9); framework-contributed mutators; a discovery subcommand; TypeScript-checker re-integration of framework files.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Contract = in-process plain objects (ignorer precedent). Framework packages extend `@systemfsoftware/oxlint-ignorer-config`, which bans Effect, `@effect/*`, and `@systemfsoftware/stryker-js-*` imports, so the contract cannot re-couple plugin and host Effect versions — the defect #29 removed. Rejected: worker-process plugins over RPC (per-file IPC for a pure text transform); in-process Effect services (the removed #29 surface). Precedent: Prettier 3 plugins are in-process objects declaring `languages` (extensions), `parsers`, and `printers`, loaded only from the explicit `plugins` option since plugin search was removed (prettier/prettier#14759). Provenance: agent default, selected when the owner's port-model question timed out on the recommended option; recorded in the PR body.
- KTD2. Discovery = the explicit `plugins` list (wiki axiom A8: discovery is explicit and manifest-declared). Extension claims fold first-wins in configured order after the built-in script entries, so core js/ts/tsx always win; every dropped claim is a shadowing row naming winner and loser (core appears as `@systemfsoftware/stryker-js-instrumenter`).
- KTD3. Refusal is data. A plugin resolves its peer with top-level await at module evaluation and exports a refusal variant (`refused: PeerMissing | PeerVersionUnsupported`, `peer`, `detail`) instead of its framework when the peer is absent (structured resolver codes only, per #26) or outside the supported range. Any other failure while importing the peer is not caught and surfaces as main's import crash. The host maps a refusal to a typed load failure; a contribution that fails the host schema or carries an unsupported `contractVersion` is `InvalidContribution`.
- KTD4. No bundled ignorer. The branch's `angular-signal-io` duplicates main's `angular-signals`; the Angular plugin exports only its framework. Its README tells users to add `@systemfsoftware/stryker-ignorer-angular` to `ignorers`.
- KTD5. Embedded documents are range slices re-parsed by the core with offset remapping (the model `parseHtml`/`parseSvelte` implement today and upstream StrykerJS's svelte parser uses). The plugin returns located script regions; the core parses, mutates, and prints each region's script through the toolkit context.
- KTD6. Open registry with a branded `FormatId`. Built-in js/ts/tsx entries plus framework entries folded at prepare; the registry rides on prepare's output to the instrument cell and the sandbox's `disableTypeChecks`, and never crosses the worker boundary.
- KTD7. Skip semantics: only unclaimed extensions skip; a claimed-but-unparseable file is a hard typed failure, including in the sandbox's `disableTypeChecks` pass.
- KTD8. Stream members, not reporter events: framework-load report, format-registry resolved, files skipped; `RunFailed` gains the reason discriminant; `STREAM_SCHEMA_VERSION` `1.0` → `1.1`. Members are emitted as queued events inside prepare and after instrumentation, never as blocking pre-steps.
- KTD9. Incremental identity is a second axis beside main's `strykerVersion` cache version (#61): per-file `{formatId, ownerModule, ownerVersion}`.
- KTD10. `@systemfsoftware/stryker-js-plugin-interface` is not changed: Framework is not a worker kind.
- KTD11. Merge, then port. Merge `origin/main`; resolve every conflicted or main-deleted path to main; restore main's trees for `packages/stryker-js-instrumenter` and `packages/stryker-js-plugin-interface`; delete branch files whose package no longer exists (`packages/stryker-js-engine/**`, `packages/stryker-js-language/**`, `apps/**`); keep `packages/frameworks/**`, `docs/**`, and `.changeset/*` for rewriting. The port lands as ordinary commits. No rebase, no force-push.
- KTD12. No lint or type suppression comments in ported code (the branch's `oxlint-disable-next-line` in `format-registry.ts` included). New files use main's suffix vocabulary (`*.schema.ts`, `*.workflow.ts`, `*.cell.ts`, `mod.ts`).

### Cross-Unit Contracts

- **Interface package** (`packages/frameworks/interface/src/mod.ts`, types only plus one constant): `FormatId` (branded), `ScriptFormat` (`js|ts|tsx`), `FrameworkClaim` (`formatId`, `extensions`, `language`, `ownerVersion`, `contractVersion`), `ScriptRegion` (`start`, `end`, `isExpression`, optional `scriptAst`), `EmbeddedDocument` (`formatId`, `rawContent`, `regions`), `FrameworkContext` (`parseScript`, `transformScript`, `printScript`, `instrumentationHeader`), `FrameworkParseFailure` (plain tagged value with a message), `Framework` (`name`, `claim`, `parse(raw, context)` → `EmbeddedDocument | FrameworkParseFailure`, `transform(document, context)` → `EmbeddedDocument`, `print(document, context)` → `string`, `disableTypeChecks(raw)` → `string | FrameworkParseFailure`), `FrameworkRefusal`, `FrameworkContribution = Framework | FrameworkRefusal`, `FRAMEWORK_CONTRACT_VERSION`. AST vocabulary is re-exported from `@systemfsoftware/stryker-ignorer-interface`.
- **Instrumenter surface:** `formatRegistry(entries)`, `coreFormatRegistry`, `FormatRegistry`, `frameworkEntryOf(moduleName, framework)`, `instrument(files, options)` with the registry in `InstrumenterOptions`, `disableTypeChecks(file, registry)`, `InstrumentResult.skipped`, plus main's existing Mutant/Location exports unchanged.

### Test Layer Classification

Admitted (test-layer gate): colocated `*.property.test.ts` for every new `*.workflow.ts` (brand law and total law); colocated schema codec laws for new non-error schemas (host framework-contribution schema, new `RunEvent` members); in-process integration tests through published surfaces (`loadPlugins`, the run programmatic surface, `instrument`, each plugin's exported `strykerFrameworks` driven through the real instrumenter). Refused: any test that spawns a process; unit tests of forwarding helpers; mocks of the toolkit context where the real instrumenter exists; snapshot files; a new e2e journey (deferred).

### Destructive Review

- **Assumptions:** (1) every framework operation is synchronous once the peer module is loaded — `angular-html-parser` `parse` and `svelte/compiler` `parse` are synchronous, and the core loads its oxc toolkit before calling hooks; (2) main's instrumenter suites are a sufficient parity oracle when the branch's files are ported onto main's tree; (3) the registry never needs to reach a worker, because the sandbox writes instrumented files host-side and workers receive mutants and file paths only.
- **Lens:** Edge-First (first cycle) — the draft named refusal paths in its decisions but its scenarios covered only happy paths and the missing-peer case.
- **Failures found and fixed:** (1) a peer that is present but throws on import was unclassified — KTD3 now leaves it as an import crash; (2) incremental reports written before identity stamps existed had no rule — R11 now recomputes a claimed file with a missing identity; (3) a framework claiming a core script extension had no rule — KTD2 now makes core win and records the shadowing.
- **Kept:** KD1-KD4; the registry, cell taxonomy, and stream-member decisions.

---

## Implementation Units

| U  | Title                                             | Depends         |
| -- | ------------------------------------------------- | --------------- |
| U1 | Merge main                                        | —               |
| U2 | Framework contract and workspace wiring           | U1              |
| U3 | Registry and framework bridge in the instrumenter | U2              |
| U4 | Loader, prepare threading, and stream members     | U2, U3 contract |
| U5 | Report labels and incremental identity            | U4              |
| U6 | Angular plugin                                    | U2, U3          |
| U7 | Svelte plugin                                     | U2, U3          |
| U8 | Mutant pipeline decisions and printer dispatch    | U3              |
| U9 | Docs, changesets, and dead-surface sweep          | U3-U8           |

Execution order: U1 → U2 → {U3, U6, U7} with U4 building against the U3 contract → U5 → U8 → U9. Every commit targets green filtered gates for the packages it touches.

### U1. Merge main

- **Goal:** the branch contains main with main's side winning every conflict (KTD11).
- **Files:** merge commit; `pnpm-lock.yaml` regenerated.
- **Test expectation:** none — the merge commit need not build; U2-U9 restore green.

### U2. Framework contract and workspace wiring

- **Goal:** the interface package defines the cross-unit contract; `packages/frameworks/*` is a workspace glob.
- **Requirements:** R1, R12 (KTD1).
- **Files:** `packages/frameworks/interface/{src/mod.ts,package.json,tsconfig.json,tsconfig.node.json,tsconfig.api.json,tsconfig.build.json,tsdown.config.ts,vitest.config.ts,oxlint.config.ts,api-extractor.json,etc/stryker-framework-interface.api.md,README.md}`; `pnpm-workspace.yaml`.
- **Patterns to follow:** `packages/ignorers/interface` on main.
- **Test expectation:** none — types plus one constant; the api report is the reviewed surface.
- **Verification:** filtered build, typecheck, lint, and api check green; the manifest has no Effect or `stryker-js-*` dependency.

### U3. Registry and framework bridge in the instrumenter

- **Goal:** main's instrumenter resolves formats through the registry, instruments framework formats only through entries built from plain `Framework` objects, reports unclaimed files as skips, and holds no html/svelte code.
- **Requirements:** R5, R6 (cells), R7 (KTD5, KTD6, KTD7, KTD12).
- **Files:** `packages/stryker-js-instrumenter/src/{format-registry.ts,resolve-format.workflow.ts,admit-instrument-files.workflow.ts,instrument-files.cell.ts,disable-type-checks.cell.ts,framework-entry.ts,type-check-disablers.ts,instrument-header.ts,Instrument.ts,Instrument.schema.ts,Parser.ts,Parser.schema.ts,Printer.ts,Syntax.ts,Syntax.schema.ts,Transformer.ts,index.ts}`; `package.json`; `etc/stryker-js-instrumenter.api.md`; `src/__tests__/resolve-format.workflow.property.test.ts`; `tests/` (delete the svelte-parsing suite; add a fixture-framework integration suite).
- **Approach:**
  1. Port the branch's registry, resolve-format, admission, and cell files from `53ac413` onto main's instrumenter.
  2. Keep main's post-base behavior: the Mutant/Location modules and exports, Oxc loading, error-text helpers, regex mutation.
  3. `framework-entry.ts` adapts a plain `Framework` with synchronous hooks.
  4. Delete html/svelte parsing, printing, transformation, and type-check disabling from core; drop `angular-html-parser` and the `svelte` peer and dev pin.
- **Test scenarios:**
  - Property: every resolve-format decision carries the brand; for generated (extension, registry) inputs the decision is assign exactly when claimed and skip otherwise.
  - An unclaimed `.svelte` file yields a skip record and no result.
  - A fixture framework's regions are instrumented and printed back at the original offsets.
  - A fixture framework whose `parse` returns a failure fails `instrument` with the typed parse error.
  - `disableTypeChecks` returns an unclaimed file unchanged and splices `@ts-nocheck` into a fixture framework's regions.
  - Every existing js/ts/tsx suite passes unchanged.
- **Verification:** instrumenter build, typecheck, lint, test, and api check green; the framework-identifier grep over `src/` and `package.json` is empty.

### U4. Loader, prepare threading, and stream members

- **Goal:** configured framework plugins load in-process, fold into the registry at prepare, reach the instrument cell and sandbox, and appear on the stream; refusals refuse the run.
- **Requirements:** R1, R4, R7, R8, R9 (KTD1, KTD2, KTD3, KTD8).
- **Files:** `packages/stryker-js/src/{Plugins.ts,Plugins.schema.ts,run/prepare.cell.ts,run/plan-prepare.workflow.ts,run/instrument.cell.ts,Sandbox.ts,RunEvent.schema.ts,run-event-wire.schema.ts,frame-run-event.workflow.ts,StreamVersion.ts,exit-classification.ts,index.ts}`; `packages/stryker-js/etc/*.api.md`; tests in `packages/stryker-js/src/__tests__/` and `packages/stryker-js/tests/` with fixture framework modules under their `__fixtures__`.
- **Approach:**
  1. Read `strykerFrameworks` in the module-contribution read and the "did not contribute" message; validate each entry with a host-owned schema.
  2. Map refusals and invalid contributions to typed load-failure reasons with ConfigError; keep main's import-crash path.
  3. Fold claims into the registry (KTD2) in prepare and thread it to the instrument cell and `Sandbox.ts`.
  4. Add the stream members, the `RunFailed` reason, the wire framing, and the version bump.
- **Test scenarios:**
  - A fixture framework in `plugins` loads; its extensions appear in the registry member with its module as owner.
  - Two fixtures claim `.html`: the first configured wins and a shadowing row names both.
  - A fixture claiming `.ts` loses to core and is recorded as shadowed.
  - Covers AE2. A refusal fixture (`PeerMissing`) refuses the run with `RunFailed` reason `PeerMissing` and exit class ConfigError.
  - A malformed contribution and an unsupported `contractVersion` each refuse with `InvalidContribution`, ConfigError.
  - A module whose import throws keeps InternalError.
  - Covers AE1. An unclaimed file in `mutate` appears in the files-skipped member and the run completes.
  - The sandbox fails the run for a claimed file whose `disableTypeChecks` returns a failure.
  - Human mode frames none of the new members; machine-mode wire lines match literal pins at version `1.1`.
  - Schema codec laws for the host contribution schema and each new member.
- **Verification:** `packages/stryker-js` build, typecheck, lint, test, and api check green.

### U5. Report labels and incremental identity

- **Goal:** labels come from the registry; incremental state carries format identity.
- **Requirements:** R10, R11 (KTD9).
- **Files:** `packages/stryker-js/src/{report-assembly.ts,mutation-reporting.ts,Mutants.ts,IncrementalReport.schema.ts,IncrementalDiff.schema.ts,admit-incremental-report.workflow.ts}` and their tests.
- **Test scenarios:**
  - A `.svelte` file owned by a fixture framework reports language `svelte`; built-in labels are unchanged.
  - An owner-version change between runs recomputes that file's mutants; a matching identity reuses them.
  - A prior report entry without an identity for a claimed file recomputes it.
  - Skipped files are absent from the incremental report.
  - The report `framework` field stays the StrykerJS constant; main's `strykerVersion` invalidation still holds.
- **Verification:** package suite green.

### U6. Angular plugin

- **Goal:** `@systemfsoftware/stryker-js-angular` exports one plain `Framework` claiming `.html`, `.htm`, `.vue`.
- **Requirements:** R2, R4 (KD3, KTD1, KTD4, KTD5).
- **Files:** `packages/frameworks/angular/**` on the ignorer template (`src/mod.ts`, `src/html-format.ts`, manifest with `angular-html-parser` from main's catalog, instrumenter as a devDependency for tests); delete `src/signal-io-ignorer.ts` and its suite.
- **Test scenarios:**
  - A multi-script `.html` document instruments every script region at its original offsets.
  - Covers AE3. A `.vue` file with `<script lang="ts">` and `<template>` bindings gets mutants only in the script region.
  - `disableTypeChecks` splices `@ts-nocheck` into each script region.
  - Unparseable html returns the parse-failure value.
- **Verification:** package build, typecheck, lint, test, api check, and attw green; the manifest names no Effect or `stryker-js-*` runtime dependency.

### U7. Svelte plugin

- **Goal:** `@systemfsoftware/stryker-js-svelte` resolves the compiler from the install at module evaluation and exports its `Framework` or a refusal.
- **Requirements:** R3, R4, R9 (KTD1, KTD3, KTD5).
- **Files:** `packages/frameworks/svelte/**` on the ignorer template (`src/mod.ts`, `src/svelte-format.ts`, `src/compiler-resolution.ts`; `svelte` optional peer `>=3.30` with a dev pin from main's catalog; `oxc-walker`).
- **Test scenarios:**
  - A component with a comparison yields script-block mutants with the compiler resolved from the install; a CJS-interop module shape is accepted.
  - The module-script header appears only when mutants were placed.
  - Expression regions print with the slice-trim behavior pinned.
  - Compiler resolution with an absent peer yields a `PeerMissing` refusal; a version below 3.30 yields `PeerVersionUnsupported`.
  - `disableTypeChecks` splices sorted regions.
- **Verification:** package build, typecheck, lint, test, api check, and attw green; the manifest names no Effect or `stryker-js-*` runtime dependency.

### U8. Mutant pipeline decisions and printer dispatch

- **Goal:** directive grammar and rule fold, `plan-mutants` and `place-mutants` workflows, collector and deep-freeze deletion, and `Match` printer dispatch on main's instrumenter.
- **Requirements:** R6.
- **Approach:**
  1. Port the branch's workflow files and printer restructure from `53ac413`.
  2. Where main changed the same logic after the merge base, main's current output is the parity target.
- **Execution note:** characterization first — main's instrumenter suites pass before and after each step, with a rebuild before trusting a green suite.
- **Test scenarios:**
  - Property: directive decode is total (directive or malformed variant, never a throw).
  - Property: rule-fold precedence matches today's disable/restore semantics.
  - Property: brand and total laws for `plan-mutants` and `place-mutants`.
  - Expression, statement, and switch-case placers place or refuse with the typed reason.
  - An unknown node kind prints through the tolerant branch identically to today.
- **Verification:** instrumenter suite green; decision files contain no `throw`, `if`, `switch`, or loops.

### U9. Docs, changesets, and dead-surface sweep

- **Goal:** consumer records match the shipped surface.
- **Files:** `.changeset/*.md` (engine, language, and CLI intents retargeted to `@systemfsoftware/stryker-js`; plugin-interface intents deleted; discovery and bundled-ignorer prose rewritten; the three debuts kept); framework READMEs (install plus the `plugins` entry; the Angular README names Vue on its first line and points to the ignorer package); root `README.md`; `packages/frameworks/AGENTS.md`; instrumenter README and AGENTS; `docs/solutions/tooling-decisions/optional-esm-peer-resolution-from-the-install.md` updated to the refusal-as-data shape.
- **Test expectation:** none — verified by `pnpm check:ci` and the changeset gate.

---

## Verification Contract

| Gate      | Command                                                           |
| --------- | ----------------------------------------------------------------- |
| Format    | `pnpm format:check`                                               |
| Types     | `pnpm typecheck`                                                  |
| Tests     | `pnpm test`                                                       |
| Full CI   | `pnpm check:ci`                                                   |
| Changeset | `./scripts/check-changeset.ts $(git merge-base HEAD origin/main)` |

Review-time oracles (run by the reviewer, not new CI gates): the framework-identifier grep over instrumenter `src/` and `package.json`; framework package manifests name no Effect or `stryker-js-*` runtime dependency; no suppression comments in the diff; scratch parity evidence never committed (CONST-T11).
