---
title: TypeScript checker on TypeScript 7 native - Plan
type: perf
date: 2026-10-09
topic: typescript-checker-tsgo-native
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# TypeScript checker on TypeScript 7 native - Plan

## Goal Capsule

- **Objective:** A Stryker run with the TypeScript checker rejects non-compiling mutants with the same verdicts as main's checker, spends less time doing it, and nothing in a published package reaches a pre-7 TypeScript compiler.
- **Product authority:** the binding unit contract `.omp-brief/unit-h-contract.md` (Done 1-5, Does-not-count, Constraints) and the supervisor rulings S1 (targeted local verification only) and S2 (a TS7-capable `@microsoft/api-extractor` is pre-approved; no override that forces TS7 onto a tool that does not support it). `CONSTITUTION.md` governs where they conflict (`CONST-1`).
- **Open blockers:** OQ1-OQ6 under Outstanding Questions are Resolve Before Planning. Two contract items are unmeasurable or vacuous as written (Done 2 on this corpus, Done 4 from today's NDJSON), and the CI parity lane needs an edit to a read-only path.

---

## Product Contract

### Summary

Keep the checker on the TypeScript 7.0.2 API it already uses, let one snapshot carry several mutants when they cannot see each other, skip importer re-checks for mutants whose edit cannot change any type outside a function body, and prove both changes with a CI gate that compares every corpus verdict against main's checker.
Remove the remaining TypeScript 5 claims, and remove the TypeScript 5 that `@microsoft/api-extractor` pulls into the lockfile through a TS7-capable release or an approved replacement for its gate.

### Problem Frame

The supervisor's premise holds for the runtime: the checker already drives TypeScript 7 through `typescript/unstable/async`, `unstable/ast` and `unstable/fs` (`packages/stryker-js-typescript-checker/src/ts-compiler.handle.ts:22-34`).
What it does per mutant is the gap.
Every mutant gets its own snapshot update, and a mutant that compiles in its own file then re-checks every transitive importer, or the whole program when the file affects global scope (`ts-compiler.handle.ts:1435-1470`).
Measured on this repo, the snapshot update is cheap and the importer re-check is not (see Measured Cost below), so the expensive step is the one with no shortcut.
Grouping exists but only buckets mutants by file (`src/group-mutants.workflow.ts:44-53`); `check()` still applies them one at a time (`ts-compiler.handle.ts:1657-1665`).
Nothing in CI compares checker verdicts between two checker builds: the mutation lane runs only on main and nightly (`.github/workflows/mutation.yml:3-17`) and runs the released CLI (`mutation.yml:30`), so a pull request's checker change is never dogfooded before merge.

### Gap Table

| Done item                                                      | What origin/main already has                                                                                                                                                                                                                                                                                                                                                                                   | What is missing                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Evidence source                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. TS7 API, N mutants per program build, measured counts       | TS7 API imports (`ts-compiler.handle.ts:22-34`); per-mutant `applyMutant` + `refreshSnapshot` (`:1484-1485`), one extra update at batch start (`:1656`) and one more on a parenthesized re-splice (`:855-861`, `:1486-1490`); file-bucket grouping (`group-mutants.workflow.ts:44-53`); TCE spawns the `tsc` binary once per file per `check()` call (`src/tce-emit.ts:46-50,103-109`)                         | No snapshot carries two mutants; no count of snapshot updates or `tsc` builds in any run output; no cited upstream API source in the repo                                                                                                                                                                                                                                                                                                                               | Code reads this session; `node_modules/typescript/dist/api/proto.d.ts:84-97`; probe below |
| 2. isolatedDeclarations shortcut, sound on the corpus          | Importer re-check and the global-scope rule (`ts-compiler.handle.ts:1397-1401,1446-1470`); import graph (`traceAffectedFiles`)                                                                                                                                                                                                                                                                                 | No shortcut exists. No project in the corpus sets `isolatedDeclarations`: repo grep finds it only in the contract; `tsc --showConfig` gives `isolatedDeclarations: null` for all eight package `tsconfig.app.json`; the shared base says "`isolatedDeclarations` is intentionally **off** … Don't enable it" (`node_modules/@systemfsoftware/tsconfig/README.md:7`). A flag-gated shortcut never fires here, so a with/without comparison on this corpus proves nothing | Grep and `tsc --showConfig` this session                                                  |
| 3. Verdict parity with main on the corpus, enforced in CI      | In-process runtime entry (`packages/stryker-js-typescript-checker/README.md:39-47`, `src/runtime/mod.ts`); annotation oracle on two checker fixtures in the PR e2e lane (`test/e2e/tests/typescript-checker.e2e.test.ts:25-34`, `test/e2e/tests/enterprise-composite-checker.e2e.test.ts:13`); manual compare tooling (`scripts/mutation-backstop.ts`, `packages/stryker-js/src/compare-verdicts.workflow.ts`) | No CI gate compares two checkers' verdicts; mutation lane is main-only and uses the released checker                                                                                                                                                                                                                                                                                                                                                                    | `mutation.yml:3-17,30`; `flake.nix:37`                                                    |
| 4. Checker phase faster than main, from the CI run's NDJSON    | `phaseDurations` on the verdict event with `prepare`, `instrument`, `dry-run`, `mutation-test` only (`packages/stryker-js/src/phase-durations.ts:42-51`, `packages/stryker-js-cli-contract/src/run-event.schema.ts:11,203-208`)                                                                                                                                                                                | No checker phase; checker time is inside `mutation-test`. No PR lane runs the workspace checker over the corpus. "Stream G" exists nowhere in the repo                                                                                                                                                                                                                                                                                                                  | Same files; scout grep for Stream G / bench lanes                                         |
| 5. No TS5 compiler API in the product; CI green with new tests | No `from 'typescript'` import in `packages/`, `test/` or `scripts/` (grep); catalog `typescript: ^7` (`pnpm-workspace.yaml:68`) resolves to 7.0.2                                                                                                                                                                                                                                                              | README still claims "TypeScript 5.x through 7.x" and "TypeScript `>=5.0.0`" (`README.md:6,17`); `typescript@5.9.3` stays in the lockfile through `@microsoft/api-extractor@7.59.1`; the private `test/e2e-core` oracle runs ts-morph 28, whose `@ts-morph/common@0.29.0` bundles TypeScript 6.0.2 (`dist/typescript.js:2291-2292`)                                                                                                                                      | Grep; lockfile; `node_modules` this session                                               |

### Supervisor Claim Check

- "`typescript` catalog is `^7`, lockfile 7.0.2": confirmed (`pnpm-workspace.yaml:68`; installed `node_modules/typescript/package.json` reports 7.0.2).
- "The checker imports `typescript/unstable/async` (API, Snapshot, Program), `unstable/ast`, `unstable/fs` at `ts-compiler.handle.ts:22-34`": confirmed. It also imports `unstable/ast/is` (`:24`), and `src/ts-files.handle.ts` imports `unstable/fs`.
- "`Compiler.schema.ts:20` refuses <7.0.0": partly wrong. Line 20 is only the error message. The refusal is `minimumTypeScriptVersion` (`ts-compiler.handle.ts:210`) checked by `guardTypescriptVersion` (`:359-367`) from `init` (`:1261`).
- "The only `typescript@5.9.3` is pulled by `@microsoft/api-extractor@7.59.1`": confirmed for `typescript@` lock entries. Incomplete as a TS-version inventory: ts-morph bundles TypeScript 6.0.2 inside `@ts-morph/common`, used only by the private `test/e2e-core` oracle (`test/e2e-core/tests/__fixtures__/diagnostics.ts:3`, `test/e2e-core/tests/concurrency-checker.integration.test.ts:22`).
- "Each mutant (or group) does `mutateFile` + `updateSnapshot` (~860-920) and `getSemanticDiagnostics` per file": per mutant, not per group. `checkOne` runs for every mutant of a group (`:1657-1665`) and does its own update (`:1485`), plus a second on re-splice (`:861`). Per-file diagnostics: confirmed (`:1329`, `:1419`).
- "Program digests, verdict reuse and per-program grouping already exist": digests and reuse confirmed (`ts-compiler.handle.ts:333-357`; engine `packages/stryker-js/src/plan-request.cell.ts:214`, `run/mutant-settlement.ts:118-120`, `run/incremental-reuse.cell.ts:341`). Grouping is per file, not per program (`group-mutants.workflow.ts:32-53`).
- "The real gap is likely snapshot updates per mutant, the shortcut, a CI parity gate, and measured speed": the last three hold. Snapshot updates per mutant are not where the time goes (Measured Cost). Two gaps are missing from the list: the TCE `tsc` spawn is a full extra program build per file per `check()` call, and the corpus has no `isolatedDeclarations` project.

### TypeScript 7 API Findings

- **What ships.** `typescript@7.0.2` exports only `./lib/version.cjs` at `.`; the API lives under `./unstable/sync`, `./unstable/async`, `./unstable/fs`, `./unstable/proto` and `./unstable/ast*` (`node_modules/typescript/package.json` exports). The 7.0 announcement: "While TypeScript 7.0 is here, it does not ship with an API. We expect TypeScript 7.1 to ship with a new (and different) API" (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/, 2026-07-08). The typescript-go README marks "API | not ready", and the repo is closed with development moved to microsoft/TypeScript (https://github.com/microsoft/typescript-go, HEAD 89d5d5b, 2026-08-20). The 7.1 API roadmap is https://github.com/microsoft/typescript-go/issues/4830.
- **IPC shape.** `new API()` spawns `tsc --api --async` and talks JSON-RPC over stdio, with `readFile` callbacks into the client's virtual file system (`node_modules/typescript/dist/api/options.d.ts:9-31`, `dist/api/fs.d.ts:5-19`; process args observed this session). Upstream `internal/ipc/conn_async.go` handles each request in its own goroutine, while snapshot updates are serialized (`internal/api/session.go` `updateMu`).
- **Several changed files per update: yes.** `updateSnapshot({ fileChanges: { changed: DocumentIdentifier[] } })` (`dist/api/proto.d.ts:84-97`). Upstream builds each snapshot by cloning the previous one and swapping changed files into the program (`internal/project/snapshot.go`, `internal/compiler/program.go` `ReuseProgram`).
- **No checker cache across snapshots.** Each new program gets a fresh checker pool (`internal/compiler/checkerpool.go`: "A partition is a checker with its own symbol, type, and instantiation caches"). The probe agrees: re-checking all 141 files after a one-file change costs about as much as the cold whole-program check.
- **No emit in 7.0.2.** `Emitter` has only `printNode` (`dist/api/async/api.d.ts:334-338`), so TCE has to spawn `tsc`. The `next` nightly `typescript@7.1.0-dev.20261009.1` adds `getJavaScriptEmit(files)`, `getDeclarationEmit(files)`, `runWithTemporaryFileUpdate` and multi-file `getSemanticDiagnostics`, and renames every export from `./unstable/*` to `./async`, `./sync`, `./ast` and so on.
- **`isolatedDeclarations` in tsgo:** the option and its TS9005-9013 diagnostics exist (`internal/core/compileroptions.go:47`, `internal/transformers/declarations/transform.go:106`). The December 2025 progress post lists "isolatedDeclarations errors" among known-incomplete work (https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/).

### N Mutants Per Program Build

- **Schemata switch in one snapshot: no.** The API would accept it, since it is only file text, but the verdicts would differ from per-mutant checking. Every mutant branch type-checks next to the original, so union types and control-flow narrowing change: a removed `return` is masked by the original branch, and a union of both branches can fail where neither mutant alone does. The repo already treats schemata as non-type-checkable and stamps instrumented code `// @ts-nocheck` (`packages/stryker-js-instrumenter/src/InstrumentHeader.ts:33`, `src/TypeCheckDisablers.ts:22-29`). Done 3 parity rules this out.
- **Overlay batching: yes, under a disjointness rule.** One update can carry mutants from different files when no mutant can change a file whose diagnostics decide another mutant in the batch. Each mutant's verdict then equals its solo verdict. Without the shortcut, a mutant can change its importers, so batches stay small; the last measurement found 1.5% fewer runs and the idea was dropped (`docs/plans/2026-09-29-0427-feat-state-of-the-art-mutation-testing-plan.md:932`). With the shortcut, a shortcut mutant changes only its own file, so many shortcut mutants from different files can share one update.
- **TCE builds.** Today every `check()` call spawns one `tsc` per file that has a passing mutant (`ts-compiler.handle.ts:1602-1622`). That is a whole extra program build in a child process, and it moves with batching.
- **Count today, per run.** Snapshot updates are M + C + P: one per checked mutant (M), one per `check()` call (C) and one per parenthesized re-splice (P). Separate `tsc` program builds equal the number of (`check()` call, file with at least one passing mutant) pairs. Since groups are per file, that is about one `tsc` build per group, and every update builds a new program with a fresh checker.

### Measured Cost

Probe: a throwaway script drove the installed `typescript/unstable/async` API (`collectTiming: true`) on `packages/stryker-js-typescript-checker/tsconfig.app.json` (141 project source files, 0 dry-run diagnostics). It flipped a body edit in `src/group-mutants.workflow.ts` through the `fs.readFile` callback, the same path the checker uses. Host: this workstation under memory pressure, with about 4-6 GB available.

| Step                                           | Measured                                                   | Samples |
| ---------------------------------------------- | ---------------------------------------------------------- | ------- |
| First `updateSnapshot` (open project)          | 449-1296 ms                                                | 4 runs  |
| Whole-program semantic diagnostics, cold       | 13.2-13.9 s; one 106.8 s outlier under swap                | 4 runs  |
| `updateSnapshot` with one changed file         | 2.4-6.4 ms                                                 | 6       |
| Own-file semantic diagnostics after the update | 13-21.7 ms (0.3-0.6 ms when repeated in the same snapshot) | 6       |
| Every project file re-checked after one change | 12.3-12.5 s                                                | 2       |
| Server processing / round trip, 149 requests   | 26.86 s / 27.19 s (transport about 2.2 ms per request)     | 1       |

A snapshot update costs a few milliseconds. The type-check that follows it is the expense, and nothing carries over between snapshots. For a body mutant that compiles in its own file, today's cost is roughly a fresh check of every transitive importer, which goes up to whole-program cost. The shortcut removes that step. Batching saves the update itself plus the per-snapshot warm-up of library types, which shows as the 13-22 ms first own-file check against 0.3-0.6 ms warm. During repeated full re-checks the API server's connection dropped twice. [INFERENCE] The cause was host memory pressure; it was not diagnosed further under S1.

### Soundness Rule for the Shortcut

A mutant cannot change any type that another file sees when all of these hold:

1. Its replaced span lies inside the body of one function-like node F: the block of a function declaration, method, constructor, accessor or function expression, or an arrow function's block or expression body. Parameters, type parameters, initializers outside F, decorators and the return type annotation are outside the body.
2. F's type as seen from outside does not depend on the body: F has an explicit return type annotation, or F is a constructor or set accessor. Without an annotation the body sets the inferred return type, including inferred type predicates, and any exported declaration typed from F changes.
3. The file is a TypeScript module (`.ts`, `.tsx`, `.mts`, `.cts`) and does not affect global scope. In JS files, constructor `this.x =` assignments and function bodies declare members. Script and `declare global` files already go to the whole-program path (`ts-compiler.handle.ts:1397-1401`).
4. The span touches no `import()` or `require()` module specifier. Changing one changes which files the program loads, which can add or remove global declarations seen elsewhere.

Under `isolatedDeclarations`, a program that passes the dry run already annotates every function whose type reaches a declaration, so rule 2 holds for every visible function. Rules 1, 3 and 4 still apply. Checking rule 2 per site is the safer gate: tsgo's own `isolatedDeclarations` errors are known-incomplete, so a project can pass the dry run while still inferring an exported type from a body.
The rule never compares signatures. KTD20 rejected hand-built signature comparison after four false-pass holes (`docs/plans/2026-09-29-0427-feat-state-of-the-art-mutation-testing-plan.md:268,928`). This rule only reads where the edit sits.
Soundness on the corpus is proven by running every corpus mutant with the shortcut forced on and forced off and requiring identical verdicts (R8). The run must also report how many mutants the shortcut decided, and a zero count fails, because an empty set proves nothing (`CONSTITUTION.md` CONST-T3).

### api-extractor and TypeScript 5 Ruling (S2)

- **Not in the product.** `typescript@5.9.3` is reachable only through `@microsoft/api-extractor@7.59.1`, a devDependency of the 17 packages that carry an `api-extractor.json`. No published package lists it in `dependencies`, and nothing in a published package imports `typescript` outside `unstable/*`.
- **It is in the merge gate.** The root `build` runs `turbo build api:check` (`package.json:24`), and `typecheck`, `test`, `lint` and `attw` depend on `api:check` (`turbo.json:37-39,69-71,107-109,127-129`).
- **No TS7-capable api-extractor exists today.** The latest release, 7.59.4 (2026-10-06), pins `typescript: 5.9.3` (`npm view`), and its `CHANGELOG.md:116` says "Upgrade the bundled compiler engine to TypeScript 5.9.3". The `8.0.0` on npm is a 2019 artifact that depends on `typescript ~3.1.6`. api-extractor needs the classic in-process compiler API, and `typescript@7` does not export one (`.` is `lib/version.cjs`). The S2 pre-approval has no release to apply to yet.
- **What removal takes.** Either a future rushstack release that runs on the TypeScript 7.1 API (pre-approved), or retiring `api-extractor` and replacing the `api:check` report gate in all 17 packages. The d.ts rollup is already native: tsdown 0.23 emits `dist/index.d.mts` through `rolldown-plugin-dts@0.28.5` with peer `typescript ^5 || ^6 || ~7.0.0` on 7.0.2, and api-extractor's own rollup only writes to `temp/` (`api-extractor.json:18-21`). Replacing the gate is a supervisor decision (OQ5). A pnpm override that forces TS7 onto api-extractor is ruled out.

### Key Decisions

- **Stay on `typescript@7.0.2` `unstable/async`; do not adopt the 7.1 nightly.** The nightly has emit APIs that could replace the TCE spawn, but it renames every import path and is a dev build. Governs R1.
- **No schemata switch for type-checking.** Combined branches change verdicts, and the repo already stamps instrumented code `// @ts-nocheck`. Governs R2.
- **The shortcut is decided by an edit-location rule, not by comparing signatures.** KTD20's objection was false passes from incomplete signatures. A location rule has nothing to miss, and its residual risk is the parity proof's job. Governs R4, R5.
- **Parity compares two TypeScript 7 checkers on the same compiler build.** Both sides run TS 7.0.2, so no TS5 or TS6 path is needed, and verdict text can be compared exactly. Governs R7, R8.
- **TS5 removal follows S2 strictly** (session-settled: user-directed — chosen over a pnpm override that forces TS7 onto api-extractor: the supervisor ruled overrides out). Governs R12.
- **Local verification stays targeted** (session-settled: user-directed — chosen over full local e2e and corpus runs: host memory is critically tight). Governs R9.

### Requirements

**Compiler boundary**

- R1. The checker reaches TypeScript only through the `typescript@7` `unstable/*` exports and the TS7 `tsc` binary. No published package can load a pre-7 compiler.
- R2. One snapshot update may carry several mutants only when they sit in different files and none can change a file whose diagnostics decide another. Each batched mutant gets exactly the verdict it would get alone.
- R3. Every run reports the number of snapshot updates and of separate `tsc` program builds, with their per-mutant ratio, in output CI keeps. Main's checker is measured the same way, so before and after compare on one corpus.

**Shortcut**

- R4. A mutant that meets the Soundness Rule is decided by its own file's diagnostics, and its file's importers are not re-checked.
- R5. A mutant that fails any clause of the Soundness Rule keeps today's path: own file, then transitive importers, or the whole program for global-scope files.

**Parity and proof**

- R6. The corpus is the mutants the instrumenter produces for this repo's packages and the e2e fixtures, selected by a rule, not by hand. OQ6 settles the exact file set.
- R7. For every corpus mutant, the new checker's verdict (status and reason text) equals main's checker's verdict.
- R8. For every corpus mutant, the verdict with the shortcut on equals the verdict with it off. The gate reports how many mutants the shortcut decided and fails when that count is zero.
- R9. R7 and R8 run in CI on every pull request and fail on any difference. No local corpus or mutation run is needed to land the change.

**Speed**

- R10. On the same corpus and the same CI host, the new checker's checking time is lower than main's, taken from the CI run's own machine-readable timings.

**TypeScript 5 removal**

- R11. Product docs state TypeScript 7 only: README prerequisites and description (`README.md:6,17`) and anything else that claims TS5 support.
- R12. `typescript@5.9.3` leaves `pnpm-lock.yaml` only through a TS7-capable `@microsoft/api-extractor` release or a supervisor-approved replacement of the `api:check` gate.

### Acceptance Examples

- AE1. **Covers R4.** Given `function f(x: number): number { return x + 1 }` in a `.ts` module, when the mutant replaces `x + 1` with `x - 1`, then only the file's own diagnostics are requested.
- AE2. **Covers R5.** Given `export const f = (x: number) => { return x + 1 }` with no return annotation, when the body mutant turns `return x + 1` into `return String(x)`, then importers are re-checked, because the inferred return type changed.
- AE3. **Covers R5.** Given a parameter default `function f(x = 1): void {}`, when the mutant changes `1` to `0`, the edit is outside the body and importers are re-checked.
- AE4. **Covers R5.** Given a body that contains `await import('./a.js')`, when the mutant replaces the specifier with `""`, the program's file set can change and importers are re-checked.
- AE5. **Covers R2.** Given shortcut mutants A in `a.ts` and B in `b.ts`, where `b.ts` imports `a.ts`, they can share one update. Given a non-shortcut mutant C in `a.ts` and mutant D in `b.ts`, they cannot, because C can change `b.ts`'s diagnostics.
- AE6. **Covers R8.** A corpus where no mutant meets the Soundness Rule fails the shortcut gate with a zero-count refusal. It does not pass on vacuous equality.

### Scope Boundaries

- No TS5 or TS6 fallback path, no `typescript-5` alias, and no parity proven on hand-picked files. These are the contract's Does-not-count items.
- No adoption of the `typescript@7.1.0-dev` nightly API in this unit.
- No signature or declaration-emit comparison to decide importer re-checks.
- No local mutation, e2e, microVM or full-workspace runs (S1). Local proof is typecheck plus the checker package's own tests.
- The `test/e2e-core` ts-morph oracle (bundled TypeScript 6.0.2) is a private test oracle, not product. Whether it stays is OQ5.

### Dependencies / Assumptions

- Stream A is moving this package into its split, and Stream D lists checker oversize files. Files this unit expects to rewrite are `src/ts-compiler.handle.ts` (1817 lines), `src/group-mutants.workflow.ts`, `src/tce-emit.ts`, `src/CheckerCommands.schema.ts`, `README.md`, plus a new pure workflow for the Soundness Rule and its property test under `src/__tests__/`. Planning names the final list for the supervisor to pass to D.
- New decision code follows `cell-architecture` pure workflows: the Soundness Rule is a `Workflow.make` decision with cyclomatic complexity 1 (pack: cell-architecture, pure-decision-workflows.md). The tests pin TS7 `unstable` API behavior the checker depends on, including multi-file `fileChanges` and that no checker cache survives a snapshot, with differential tests that re-fire on upgrade (pack: boundary-testing, pin-dependency-semantics.md).
- The released checker in `.sfs-deps` (8.3.1, flake pin `27b1075`) lags `origin/main` by three checker commits, all on digest and `extends` resolution (`git log 27b1075..origin/main -- packages/stryker-js-typescript-checker/src`).
- `CHANGELOG.md:65` (8.1.0) says importers are re-checked "only when the mutant changes what that file exports". The code re-checks them whenever own-file errors are zero (`ts-compiler.handle.ts:1459-1470`). Once R4 ships the claim becomes partly true, and the changeset should state the actual rule.

### Outstanding Questions

#### Open questions for the supervisor (Resolve Before Planning)

- OQ1. **Done 2 is vacuous on this corpus.** No corpus project sets `isolatedDeclarations`, and the shared tsconfig forbids it. Pick one: (a) gate the shortcut on the per-site Soundness Rule alone, which fires on this corpus and keeps `isolatedDeclarations` as one case where rule 2 always holds (recommended); (b) keep the flag gate and add an `isolatedDeclarations` e2e fixture so the proof has a non-empty set; (c) both.
- OQ2. **"Main's checker" for parity.** Pick one: (a) build the checker from the PR's merge-base with `origin/main` inside the parity lane (recommended: faithful to "main", with no release lag); (b) the released 8.3.1 tarball already installed from `.sfs-deps`, which costs no build but lags main by three commits.
- OQ3. **Where the parity and speed gate runs.** `.github/workflows/` is read-only (root `AGENTS.md` Boundaries). Pick one: (a) approve a new `checker-parity` job in `ci.yml`, sharded like the e2e lane (recommended); (b) run it inside the existing `check` job as a test of the checker package, which needs no workflow edit but loads `pnpm check:ci` and runs locally whenever that package's tests run (conflicts with S1). Also confirm that instrument-and-check without a test runner is not a "mutation run" under the no-local-mutation constraint.
- OQ4. **Done 4 timings.** NDJSON has no checker phase. Pick one: (a) the parity lane times both checkers on the identical mutant set and writes its own machine-readable timings (recommended: same host, same mutants, no stream-schema change); (b) add a checker bucket to `phaseDurations`, a `StreamSchemaVersion` bump under KTD18, which only helps after a release because the mutation lane runs the released CLI. Also decide whether OQ4(a) satisfies "from the CI run's own NDJSON phase timings".
- OQ5. **TS5 and TS6 outside the product.** Pick one: (a) rule `typescript@5.9.3` under api-extractor and ts-morph's bundled 6.0.2 as dev tooling, outside Done 5, and track the api-extractor bump for when rushstack ships TS7 support (recommended); (b) retire api-extractor now, which means approving a replacement `api:check` gate for 17 packages (GATE1), and replace the ts-morph oracle in `test/e2e-core` with a TS7 one.
- OQ6. **Corpus file set.** The contract says "this repo's packages + the e2e fixtures". Pick one: (a) every workspace package's non-test TypeScript sources under its app tsconfig, plus every e2e fixture configuration that enables the checker (recommended: broadest set that is still rule-selected, sharded in CI); (b) only the four dogfood projects' `mutate` globs (`mutation.yml:29`) plus checker-enabled e2e fixtures (cheaper, but the checker package itself mutates only `*.workflow.ts` and `*.schema.ts`).

#### Deferred to Planning

- How a batch's mutants are attributed and re-spliced when one fails to parse (`parseHeldAfterSpliceOf`, `ts-compiler.handle.ts:841-853`) without breaking R2.
- Whether TCE emits for every file of a batch in one `tsc` spawn instead of one per file.
- The dogfood mutant ids the new tests target, cited from main's latest mutation report as the contract requires.
- Corpus sharding and the wall-time budget for the parity lane in CI.

### Sources

- `.omp-brief/unit-h-contract.md`; `CONSTITUTION.md` (CONST-T3, CONST-P1/P2); root `AGENTS.md` Boundaries; `packages/AGENTS.md` SCHEMA-1.
- `node_modules/typescript` 7.0.2: `package.json` exports; `dist/api/async/api.d.ts:23-206,334-338`; `dist/api/proto.d.ts:51-97`; `dist/api/options.d.ts:9-31`; `dist/api/fs.d.ts:5-19`.
- Upstream: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ ; https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/ ; https://github.com/microsoft/typescript-go (HEAD 89d5d5b) `internal/api/proto.go`, `internal/api/session.go`, `internal/compiler/program.go`, `internal/compiler/checkerpool.go`, `internal/ipc/conn_async.go` ; https://github.com/microsoft/typescript-go/issues/4830 ; https://github.com/nrwl/nx/issues/36104.
- api-extractor: `npm view @microsoft/api-extractor` (7.59.4, 2026-10-06, `typescript: 5.9.3`); its `CHANGELOG.md:116`.
- Prior decisions: `docs/plans/2026-09-29-0427-feat-state-of-the-art-mutation-testing-plan.md:268,928-932`.
