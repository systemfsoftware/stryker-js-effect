---
title: Native Instrumenter Core - Plan
type: feat
date: 2026-10-09
topic: native-instrumenter-core
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Native Instrumenter Core - Plan

## Gap Table

Each Done item of the Unit F contract, against `origin/main` at `1e1de6d05`.

| Done item                                                                                                                                                                                    | What `origin/main` has                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | What is missing                                                                                    | Evidence                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Rust crate + napi-rs addon in its own package, built by the flake for x86_64-linux and aarch64-linux, shipped in the flake tarballs                                                       | `flake.nix:43` lists both Linux systems; `flake.nix:57-64` builds every workspace package with `mkPnpmWorkspacePackages`, which runs `pnpm -r run build` (pnpm-release-management `nix/lib/pnpm-workspace-packages.nix:104-108`) and `pnpm pack` per member (`:113-115`); its `files` argument copies any derivation's contents into `src` (`nix/lib/pnpm-store.nix:26-29`). Stream A reserves the package slot (`origin/stream-a/l1-ports-topology`, ports-split plan KTD12, "Reserved package") | No `Cargo.toml` anywhere in the repo; no Rust derivation, no `.node` binary, no loader, no package | Probe: `rustPlatform.buildRustPackage` from the pinned nixpkgs built an oxc 0.150 + napi 3 cdylib in 64 s; `pkgsCross.aarch64-multiplatform` built the aarch64 one in 51 s on the x86_64 host; both need at most `GLIBC_2.34`; Node 24.21 loaded the x86_64 binary and called its exports |
| 2. Byte-identical output to the current JS pipeline on this repo's packages + e2e fixtures, same mutant ids and spans, parity test in CI; id hash changes only through a versioned cache key | The JS pipeline: `packages/stryker-js-instrumenter/src/Parser.service.ts:41-51` (oxc-parser), `Transformer.service.ts`, `Printer.ts` over `print/SourceText.ts:213`, ids from `MutantIdentity.ts:27-34`; cache version `packages/stryker-js/src/verdict-semantics.ts:21`                                                                                                                                                                                                                          | Corpus enumeration, a differential spec, and a reference that survives Done 4's deletion           | Measured below (Q1): oxc_codegen output equals SourceText on 178 of 1003 corpus files at best                                                                                                                                                                                             |
| 3. Instrument phase >=3x faster than main, measured in CI                                                                                                                                    | OTel span `stryker.instrument` in the e2e telemetry artifact every CI run uploads (`.github/workflows/ci.yml:133-143`, 7-day retention); NDJSON `phaseDurations` only from `mutation.yml` on main (Q5)                                                                                                                                                                                                                                                                                            | A main-vs-branch comparison over CI artifacts; Stream G's bench lane is not on main                | Baseline from main run `37960922619` (head `1e1de6d05`): 32 `stryker.instrument` spans, 14,159 ms summed, median 345 ms                                                                                                                                                                   |
| 4. `print/SourceText.ts` and the JS hashing deleted, no fallback                                                                                                                             | Both present: `print/SourceText.ts` (2,206 lines), `MutantIdentity.ts` importing `@noble/hashes/sha2.js` (`:1`)                                                                                                                                                                                                                                                                                                                                                                                   | Everything                                                                                         | `wc -l` over `packages/stryker-js-instrumenter/src`                                                                                                                                                                                                                                       |
| 5. CI green on the exact head with the new tests running                                                                                                                                     | `ci.yml:27-36` installs Nix, dprint, pnpm, and Node; no Rust toolchain in CI                                                                                                                                                                                                                                                                                                                                                                                                                      | A CI path that builds the addon without editing `.github/workflows/` (read-only per `AGENTS.md`)   | `ci.yml` read in full                                                                                                                                                                                                                                                                     |

---

## Goal Capsule

- Objective: a `stryker run` instruments in at most a third of today's instrument-phase time and produces the same instrumented files and the same mutant table as today.
- Means: one napi-rs addon over the oxc crates does parse, mutant generation, schemata placement, printing, and id hashing; Effect TS keeps orchestration and reaches the addon as a driver behind the `Instrumenter` port.
- Product authority: the Unit F contract (the supervisor's brief, kept outside the repo) and `CONSTITUTION.md`.
- Open blockers: S1-S10 in Open Questions for the Supervisor. Layers 1-2 have none; layer 3 needs S2 (ignore reasons are part of the mutant table); layer 4 needs S4; layer 5 needs S10.

---

## Product Contract

### Summary

A new workspace package holds a Rust crate and its napi-rs binding. It takes source files plus mutator selection data and returns instrumented source text, the mutant table, and skips. It reproduces the current output byte for byte, including the SourceText formatting. Nix builds it for both Linux architectures and every tarball carries both binaries. The JS printer, the JS mutators, and the JS id hashing are deleted when the driver switches.

### Problem Frame

The instrument phase is CPU-bound JS over a JS AST. On main CI it costs 14.2 s across the 32 e2e runs, and parse plus transform account for 9.5 s of it (`stryker.instrument.parser.parseWithOxc` 3,918 ms, `stryker.instrument.transform.script` 5,570 ms). Run locally over the 1003-file corpus, one file at a time, the same pipeline produced 69,457 mutants in 86.9 s summed wall time with a 452 MB peak RSS; `packages/stryker-js-cli-contract/src/SpanTaxonomy.ts` alone took 15.4 s for 487 mutants. Reprinting alone is slow: SourceText took 11.65 s to parse, attach comments, and print the 1003 files, while oxc parse plus oxc_codegen took 32 ms on the same machine. These local numbers motivate the design and do not count toward Done 3.

### Answers to the Load-Bearing Questions

**Q1. SourceText is a whole-program printer; parity comes from porting its format to Rust.**

- Verified. `printProgram` (`print/SourceText.ts:125-128`) prints the whole `Program` through `programText` (`:213`), with its own indentation of two spaces per level (`:302`), its own precedence table (`printNodePrec`, used at `:450` and elsewhere), and comment placement from `leadingComments`/`trailingComments` (`:275-300`) that `Ast.handle.ts:413-503` attaches before printing. It is not a span splicer: SourceText output equals the original file on 0 of 1003 corpus files, so a splicer cannot match today's output either.
- oxc_codegen cannot be configured to match. It always reprints (`Codegen::build`, oxc_codegen 0.150.0 `src/lib.rs:274`) and exposes only quote style, minify, comment classes, indent character and width, and initial indent (`src/options.rs:7-62`, `CommentOptions` at `:116-151`); there is no source-preserving mode. Measured over the corpus (`git ls-files packages test/e2e/testResources`, script extensions, no `dist/`: 933 `.ts`, 38 `.js`, 28 `.mjs`, 2 `.tsx`, 1 `.cjs`, 1 `.mts`), unmutated:

| oxc_codegen options                        | Byte-identical to SourceText | Whitespace-only diff | Token-level diff |
| ------------------------------------------ | ---------------------------- | -------------------- | ---------------- |
| default                                    | 71                           | 23                   | 909              |
| single quotes, 2-space indent              | 178                          | 223                  | 602              |
| single quotes, 2-space indent, no comments | 169                          | 205                  | 629              |

- Decision: port SourceText's format to a Rust printer over the oxc AST. oxc_codegen is not used for output. Changing the emitted format to oxc_codegen's is outside the contract and is S1.

**Q2. Every JS reader of the oxc AST either moves into Rust or is replaced by data from the addon.**

| Consumer (today)                                                                                                                                                                                | Role                                                                                                                                                                                           | Decision                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Parser.service.ts:41-51`, `drivers/oxc-program.ts:7-19`                                                                                                                                        | `oxc-parser` `parseSync` with ranges, comments                                                                                                                                                 | Rust (`oxc_parser`); JS parse deleted                                                                                                                              |
| `Ast.handle.ts` (779 lines)                                                                                                                                                                     | node constructors, `cloneNode`, traversal, `attachComments` (`:413-503`)                                                                                                                       | Rust (oxc `AstBuilder`, `oxc_traverse`); deleted                                                                                                                   |
| `Transformer.service.ts` (1,433 lines)                                                                                                                                                          | traversal, ignorer calls (`:831-839`), directive decode, placement (`:1336-1345`)                                                                                                              | Rust                                                                                                                                                               |
| `plan-mutants.workflow.ts`, `place-mutants.workflow.ts`, `mutant-set-policy.workflow.ts`, `arid-code.workflow.ts`, `relational-sufficient-sets.ts`, `directives/*`                              | pure decisions over planned mutants and AST facts                                                                                                                                              | Rust; their laws keep running through the addon's public surface                                                                                                   |
| `Mutator.service.ts` (1,522 lines: 16 stock mutators, registry, selection), `EffectCall.ts`, `AtomicUpdateSplit.ts`, `SynchronizationRemoval.ts`, `FinalizerEscape.ts`                          | mutant generation                                                                                                                                                                              | Rust; selection stays data (`optInMutations`, `excludedMutations`, `mutantSetPolicy`) per Stream A KTD12                                                           |
| `InstrumentHeader.ts`                                                                                                                                                                           | schemata header statements                                                                                                                                                                     | Rust                                                                                                                                                               |
| `disable-type-checks.cell.ts`, `TypeCheckDisablers.ts`                                                                                                                                          | `disableTypeChecks` on the port                                                                                                                                                                | Rust                                                                                                                                                               |
| `Printer.ts`, `print/SourceText.ts`                                                                                                                                                             | printing                                                                                                                                                                                       | Rust printer (Q1); deleted                                                                                                                                         |
| `MutantIdentity.ts`                                                                                                                                                                             | id hashing                                                                                                                                                                                     | Rust (Q3); deleted                                                                                                                                                 |
| `FrameworkEntry.ts`, `Format.ts`; `packages/frameworks/angular/src/html-format.ts:188,220`; `packages/frameworks/svelte/src/framework.ts:76,85,146,216`                                         | framework plugins receive a JS `Program` through `FrameworkContext.parseScript`/`printScript` (`packages/frameworks/interface/src/mod.ts:32-36`) and Svelte unshifts header statements into it | A framework plugin locates script regions and splices printed text back; the addon parses, mutates, and prints each region. Breaking the framework interface is S4 |
| `packages/ignorers/*` via `packages/ignorers/kit/src/define-ignorer.ts:54-63`                                                                                                                   | JS predicates over a JS node and its ancestors, called once per mutant candidate                                                                                                               | Blocked on S2                                                                                                                                                      |
| Plugin mutator contributions (`Mutator.service.ts:1456-1458`, a JS `Mutator` per entry)                                                                                                         | JS mutators over a JS AST                                                                                                                                                                      | Blocked on S2                                                                                                                                                      |
| `packages/stryker-js-typescript-checker/src/ts-files.handle.ts:2-3`, `ts-compiler.handle.ts:5`; `ErrorText` and `Instrument` imports in the checker and `packages/stryker-js-vitest-runner/src` | offsets, line starts, error text, activation constants; no AST                                                                                                                                 | Stay TypeScript; Stream A U22 moves the driver-neutral ones to `stryker-js-contracts`                                                                              |

**Q3. Ids: BLAKE3 inside the approved list, with `INCREMENTAL_CACHE_VERSION` as the versioned key.**

- Today: SHA-256 over five length-prefixed fields (`MutantIdentity.ts:7`, field order `:20-25`), hex, truncated to 16 characters (`:29-34`).
- The approved crates include `blake3` and no SHA-256 implementation, so keeping today's ids needs an unapproved crate (S3). With BLAKE3 over the same length-prefixed preimage, truncated to 16 hex, every id changes once.
- The versioned key that gates reuse is `INCREMENTAL_CACHE_VERSION = '4'` (`packages/stryker-js/src/verdict-semantics.ts:21`), checked when the incremental report is read (`read-project.cell.ts:402`) and written (`mutation-reporting.service.ts:862,950`). The id change bumps it to `'5'`.
- Stream B (`origin/stryker/verdict-store`): the verdict key embeds `components.mutantId` (`packages/stryker-js/src/verdict-store/encode-verdict-key.workflow.ts:50`) under `KEY_LAYOUT = 'verdict-key/1'` (`:15`). New ids miss old verdicts by construction, so the layout stays at `/1`. The key also carries an engine digest over `ENGINE_PACKAGE_SPECIFIERS` (`verdict-semantics.ts:16-19`: `stryker-js`, `stryker-js-vm-runner`). The `.node` binary is not inlined into the `stryker-js` bundle, so the native package joins that list; otherwise a changed binary would reuse stale verdicts.

**Q4. Nix builds both binaries with nixpkgs' `rustPlatform`, and one package carries both.**

- Build: `rustPlatform.buildRustPackage` with `cargoLock.lockFile` hashes every crate from `Cargo.lock` with no vendor hash, matching the hashless policy `flake.nix:12-15` states for pnpm. `pkgsCross.aarch64-multiplatform.rustPlatform` builds the aarch64 binary from either host. No crane, fenix, naersk, or `@napi-rs/cli`; `napi-build` in `build.rs` plus `napi-derive` produce a loadable cdylib (probe exports loaded under Node 24.21).
- Fixups the probe exposed: the built library has `RUNPATH` into `/nix/store/...-glibc-2.44-25/lib` and `...-gcc-16.2.0-lib/lib`, which must be removed before it ships; it needs `libgcc_s.so.1`, `libc.so.6`, and the loader, with symbol versions up to `GLIBC_2.34`.
- Packaging: the binaries are laid into the package directory through `mkPnpmWorkspacePackages`' `files` argument, which `cp -r`s a derivation into `src` (`pnpm-store.nix:26-29`), so `pnpm pack` includes them. Both binaries go in one package: two files, no per-platform `optionalDependencies`, and no new entries in the `.sfs-deps` overrides in `pnpm-workspace.yaml`. oxc-parser instead publishes one package per target (`node_modules/oxc-parser/package.json:120,134`) and picks one at runtime (`src-js/bindings.js:266-330`).
- Loading: a TypeScript loader picks `linux-${process.arch}-gnu` and fails with a typed error on any other platform, musl included (oxc-parser's musl probe: `bindings.js:12-60`).
- CI build: CI has Nix but no cargo, and `.github/workflows/` is read-only. The package's `build` script runs the flake's binding derivation; inside the Nix sandbox the `files` mapping has already placed the binaries. S6 asks whether that is acceptable.

**Q5. NDJSON phase timings exist only on main's mutation run, and their artifacts are deleted; the e2e traces are the CI baseline.**

- Emitter: `RunEventDrain` writes framed run events to `reports/mutation-stream.jsonl` (`packages/stryker-js/src/run-event-stream.service.ts:105`); the verdict record carries `phaseDurations` (`:272`), computed in `packages/stryker-js/src/phase-durations.ts:42-50` with `instrument` = dry-run start minus instrument start (`:47`).
- In CI only `.github/workflows/mutation.yml` runs Stryker, on main pushes, cron, and manual dispatch. Shard reports upload as `mutation-shard-*` (`:218-219`) and are deleted once merged (`:344`). Mutation never runs on a PR, so a branch has no NDJSON to compare.
- Every CI run, PRs included, uploads e2e telemetry with `stryker.instrument` spans (`ci.yml:133-143`), and the e2e harness packs the workspace build (`test/e2e/src/Harness/fixture-cache.service.ts:450`), so branch traces measure branch code. Baseline from main run `37960922619`: `stryker.instrument` 32 spans, 14,159 ms summed, median 345 ms, max 1,266 ms.
- Decision: until Stream G's bench lane lands, Done 3 is judged from the summed `stryker.instrument` spans of the branch head's e2e telemetry against main's run at the merge base. This departs from the contract's "the CI run's own NDJSON" (S5).

**Q6. Nothing upstream generates mutants or schemata; the printer is the only part that would not exist under a format change.**

- oxc 0.150 ships parser, AST builder, traverse, semantic, codegen, transformer (TypeScript/JSX/ES lowering), minifier, and linter crates; none generates mutants or switches between them at runtime. Searches for Rust- or oxc-based JS mutation tools found only Rust-code tools (cargo-mutants, mutest-rs) and JS tools built on other parsers (StrykerJS on Babel, mutode).
- oxc's raw transfer (`experimentalRawTransfer`/`experimentalLazy`, `node_modules/oxc-parser/src-js/index.js:57-65`) moves an AST into JS cheaply but needs Node >= 22 (`raw-transfer/common.js:20-25`); the instrumenter declares `node >= 20` (`packages/stryker-js-instrumenter/package.json:68-70`). It matters only if JS ignorers survive (S2).
- Parts that disappear: JS parsing (`oxc-parser`, `oxc-walker` leave the instrumenter), `Ast.handle.ts`, and `attachComments`. The ported SourceText printer would also disappear if S1 adopts oxc_codegen's format.

### Requirements

**Native package and build**

- R1. A new workspace package holds the Rust crate, its napi-rs binding, and a TypeScript loader; it depends on no other workspace driver, and only the CLI composition root depends on it.
- R2. The flake builds the addon for x86_64-linux-gnu and aarch64-linux-gnu with nixpkgs' `rustPlatform`, and every flake tarball of the package contains both binaries with no `/nix/store` `RUNPATH`.
- R3. Loading on any platform other than Linux x64/arm64 glibc fails with a typed error that names the platform; there is no JS fallback.
- R4. Rust dependencies are only the oxc crates, `napi`, `napi-derive`, `napi-build`, `rayon`, and `blake3`.

**Behaviour**

- R5. One addon call takes a batch of files plus selection data and returns instrumented source text, the mutant table (id, mutator name, original and replacement code, location, ignore reason), and skips, matching the `Instrumenter` shape in Stream A KTD12.
- R6. The addon also provides `disableTypeChecks` with the same output as `disable-type-checks.cell.ts`.
- R7. Instrumented source text is byte-identical to the JS pipeline's for every corpus file, including SourceText formatting and comment placement.
- R8. Mutant spans, mutator names, original and replacement code, ordinals, and ignore reasons equal the JS pipeline's for every corpus file.
- R9. A mutant id is the first 16 hex characters of BLAKE3 over today's length-prefixed five-field preimage, unless S3 approves SHA-256.
- R10. Output is deterministic and independent of rayon thread count and file order.

**Cache keys**

- R11. The id change bumps `INCREMENTAL_CACHE_VERSION` to `'5'`, and the native package joins `ENGINE_PACKAGE_SPECIFIERS`.

**Proof and removal**

- R12. A differential spec in CI compares the addon with the JS pipeline over the whole corpus: every tracked script under `packages/**` and `test/e2e/testResources/**` (excluding `dist/`), plus framework files once S4 is settled. Ids are compared through their preimages and a BLAKE3 recomputation.
- R13. CI shows the summed `stryker.instrument` span time of the branch head's e2e telemetry at no more than one third of main's at the merge base (per Q5, pending S5).
- R14. `print/SourceText.ts`, `MutantIdentity.ts`, the JS mutators, `Ast.handle.ts`, and the instrumenter's `@noble/hashes`, `oxc-parser`, and `oxc-walker` dependencies are deleted in the layer that switches the driver.
- R15. Each published break (instrumenter API, framework interface, ignorer and plugin-mutator contracts per S2/S4, ids) ships with a changeset at the BREAK-1 level.

### Key Decisions

- **Port the SourceText format to Rust instead of using oxc_codegen for output.** oxc_codegen matches 178 of 1003 files at best, and the contract excludes format changes. Governs R7.
- **BLAKE3 ids behind a cache-version bump.** It is the only hash in the approved list; the verdict key needs no layout bump because the id is already a key component. Governs R9, R11.
- **One package carrying both Linux binaries.** It avoids per-platform packages and new `.sfs-deps` overrides; the cost is a second ~1.6 MB binary in each install (probe size; the real addon will be larger). Governs R2, R3.
- **The e2e OTel spans are the CI speed evidence until Stream G lands.** Branches have no NDJSON, and main's is deleted after merge. Governs R13.
- **The cutover and the deletion ship in one layer.** No commit on main has both drivers wired. Governs R14.

### Proposed Stack

Trunk `main`, built with `gh stack`. Layers 1-3 land inert: nothing calls the addon until layer 4.

1. `stryker/native-core` (this brainstorm, then the plan): docs only.
2. Native package and printer (R1-R4, R7 for unmutated files): crate, binding, loader, Nix derivations for both arches, tarball inclusion, the Rust SourceText printer, and a differential spec that reprints the corpus against `printProgram`.
3. Mutant generation (R5, R8-R10, R12 for the mutant table): parse, directives, stock and Effect mutators, plan and set policy, ids. The differential spec compares mutant tables against the JS pipeline.
4. Placement and full instrument parity (R5-R7, R12): schemata placement, header, `disableTypeChecks`, framework regions per S4. The differential spec compares instrumented text.
5. Cutover and deletion (R11, R13-R15): the Effect driver Layer behind Stream A's `Instrumenter` port calls the addon; JS code and dependencies are deleted; cache keys move; changesets; CI speed evidence. The differential reference after deletion is S7.

Stream C's mutator changes merge up into layers 3-5 and are ported as they land.

### Scope Boundaries

- No macOS, Windows, or musl binaries.
- No change to the emitted source format unless S1 approves one.
- No local mutation runs; Rust code is not mutation-tested in this unit (S8).
- No new CI workflow steps (`.github/workflows/` is read-only).
- Checker, runner, and execution-engine work stays with Streams H and G.

### Dependencies / Assumptions

- Stream A's U22 `Instrumenter` port (`origin/stream-a/l1-ports-topology`, ports-split plan U22) is the seam layer 5 plugs into.
- Stream B's verdict key layout stays `verdict-key/1` and keeps `mutantId` as a component.
- The e2e lane keeps uploading `stryker.instrument` spans on every CI run.

### Outstanding Questions

#### Resolve Before Planning

None for layers 1-2. Layer 3 needs S2, layer 4 needs S4, and layer 5 needs S10.

#### Deferred to Planning

- Which oxc traversal, `oxc_traverse` or `oxc_ast_visit` `VisitMut`, best fits placement while spans and comment positions are kept.
- How today's fast-check laws for the plan, place, and policy workflows run against the addon's public surface.
- Rayon batching granularity and how batching interacts with the Effect driver's spans.

### Open Questions for the Supervisor

- S1. May the emitted format change to oxc_codegen's? That deletes the printer port (the largest Rust module) at the cost of one id- and output-wide re-baseline; the contract currently excludes it.
- S2. JS ignorers (`packages/ignorers/*`) and plugin mutator contributions are JS functions over a JS AST. Options: (a) port the three in-repo ignorers to Rust and remove both plugin contracts; (b) call back into JS per candidate with a raw-transfer AST, which needs Node >= 22 and gives back much of the speedup; (c) a declarative ignorer form evaluated in Rust. Recommendation: (a).
- S3. Approve the `sha2` crate to keep today's ids, avoiding a full verdict invalidation on main and stale id citations in tests? Otherwise BLAKE3 per R9.
- S4. Approve breaking `@systemfsoftware/stryker-framework-interface` so framework plugins exchange script regions as offsets and text, and the addon injects the header (replacing Svelte's AST unshift at `packages/frameworks/svelte/src/framework.ts:146`)?
- S5. Accept the e2e `stryker.instrument` spans as the CI speed evidence instead of NDJSON, given branches have no mutation run and main's shard artifacts are deleted (`mutation.yml:344`)?
- S6. CI has no cargo. Accept a package `build` script that invokes the flake's binding derivation, or approve a workflow change?
- S7. After deletion, the differential spec needs a reference. Options: the released `stryker-js-instrumenter` tarball in `.sfs-deps` until the first native release, or retiring the spec at deletion (Done 5 then runs it only on layers 2-4).
- S8. Rust code is outside Stryker-JS mutation. Approve `cargo-mutants` (a dependency outside the list) or accept the gap?
- S9. Gate Rust formatting with `rustfmt` from nixpkgs? That is a new gate under `GATE1`.
- S10. Layer 5 needs U22. Stack it on `stream-a/l1-ports-topology` if Stream A's L2 is still open, or wire it into today's call site (`packages/stryker-js/src/run/instrument.ts:109-120`) and let Stream A move it?

### Sources

- Unit F contract: the supervisor's brief, not committed.
- Stream A seams: `origin/stream-a/l1-ports-topology`, `docs/plans/2026-10-09-2025-refactor-ports-split-capability-packages-plan.md` KTD12 and U22.
- Stream B key: `origin/stryker/verdict-store`, `packages/stryker-js/src/verdict-store/encode-verdict-key.workflow.ts`.
- oxc 0.150.0: `oxc_codegen` `src/options.rs`, `src/lib.rs`; `oxc-parser` `src-js/bindings.js`, `src-js/index.js`, `src-js/raw-transfer/common.js`.
- pnpm-release-management (flake input): `nix/lib/pnpm-workspace-packages.nix`, `nix/lib/pnpm-store.nix`.
- `docs/solutions/runtime-errors/mutant-replacement-text-captured-before-placement.md`: replacement text must be printed before placement rewrites the node, which the Rust port must keep.
