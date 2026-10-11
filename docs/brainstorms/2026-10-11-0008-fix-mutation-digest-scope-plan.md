---
title: Scope each project's run-inputs digest to its own lockfile closure
date: 2026-10-11
type: fix
topic: mutation-digest-scope
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Scope each project's run-inputs digest to its own lockfile closure

## Goal Capsule

- **Objective:** A `pnpm-lock.yaml` edit that cannot change what a mutated project installs leaves that project's saved verdicts reusable, so main's Mutation run re-tests only the projects whose installed dependencies actually moved.
- **Means:** `runInputsDigestOf` hashes the project's resolved dependency closure from `pnpm-lock.yaml` instead of the whole file.
- **Product authority:** Root ruling 2026-10-11 (Stream K, one small PR off `main`). The approach is settled. This doc records the verified premises, edge cases and acceptance examples.
- **Open blockers:** none.

---

## Product Contract

### Summary

Today every project's run-inputs digest includes the full lockfile text, so any lockfile edit makes every project re-verify every mutant. Each project's digest will instead cover its own closure in `pnpm-lock.yaml`: its importer, the importers it links, the importers above it, and every snapshot reachable from those, together with each snapshot's package metadata. Other lockfile formats keep today's whole-file behaviour.

### Problem Frame

`runInputsDigestOf` (`packages/stryker-js/src/verdict-semantics.ts:158-174`) reads the nearest lockfile and passes its whole text into `runInputsDigestOfParts` (`:122-123`, `:171`). A saved verdict is reused only when the digest matches. #274 added 39 lockfile lines for a bench importer, and #266 added 70 for a new importer, `test/checker-parity`. Neither change reaches any mutated project, but after each one main's next Mutation run re-tested everything. The operator measured the mutation-shard median rising from about 161 s (run 38083502908) to about 630 s (run 38091732059). The budget gate then failed at 807 s and 714 s against a 701 s budget.

A probe over the real lockfiles confirms the scoping would have prevented this. Using the closure rule in R1–R3, all four mutated projects' closure digests are unchanged across #274 and #266, and all four change across the v18.1.0 tarball pin bump (#251), which did alter installed bytes.

### Verified premises

| #   | Premise                                                                                                                                                 | Status                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Closure = importer (path relative to the lockfile dir), then snapshots by resolved ref, including peer suffixes and `patch_hash`, plus linked importers | Verified, with three additions (P1a–P1c) | Importer keys are dir paths (`pnpm-lock.yaml:219` `.`, `:700` `packages/stryker-js`). Peer suffixes and `patch_hash` are in the ref (`:704`, `:756`). Links are relative `link:` refs (`:734`). The probe over `ec9dcf63c` follows 476–488 snapshots and 13–15 importers per project and finds no dangling ref.                                                                                                                                                                               |
| P1a | Aliased refs name their own target                                                                                                                      | Verified                                 | Scoped alias to a file tarball (`@systemfsoftware/stryker-js-vm-runner` → `@systemfsoftware/stryker-js-vitest-runner@file:…`), unscoped alias (`released-stryker-js-cli-contract`) and a JSR alias (`@std/jsonc` → `@jsr/std__jsonc@1.0.2`). A naive `name@ref` key leaves these dangling; pnpm's `refToRelative` rule resolves all of them.                                                                                                                                                  |
| P1b | A local tarball keeps one key across re-packs, so its bytes are only in `packages[…].resolution.integrity`                                              | Verified                                 | `packages['@systemfsoftware/stryker-js@file:.sfs-deps/stryker-js.tgz']` carries `integrity` and `version: 18.1.0`. Without the packages entry, a pin bump would leave digests unchanged.                                                                                                                                                                                                                                                                                                      |
| P1c | Node resolution from a workspace package walks up to ancestor `node_modules`, including the root importer's                                             | Verified (probe)                         | Including the ancestor importer `.` still leaves #274 and #266 digests unchanged.                                                                                                                                                                                                                                                                                                                                                                                                             |
| P1d | `overrides`, `patchedDependencies` and `catalogs` act only through resolved refs                                                                        | Verified                                 | Overrides show up as `file:.sfs-deps/…` refs plus their integrity (`:774`, `:783`). A patch shows up as `patch_hash` in the ref (`:756`). A catalog shows up as each importer's resolved `version` (`:222-223`). `pnpmfileChecksum`, `packageExtensionsChecksum` and `time` are absent from this lockfile; their effects would also land in the graph.                                                                                                                                        |
| P1e | `settings` and `lockfileVersion` are global                                                                                                             | Verified                                 | `pnpm-lock.yaml:1-5`. The lockfile does not record hoisting or `node-linker` settings, and today's digest doesn't cover them either.                                                                                                                                                                                                                                                                                                                                                          |
| P2  | Non-pnpm lockfiles keep whole-file behaviour; an unusable `pnpm-lock.yaml` must not produce a constant digest                                           | Verified (current code)                  | `LOCKFILE_NAMES` (`verdict-semantics.ts:36-42`) and `findUpFrom` (`:135-150`). `readIfPresent` (`:152-156`) already maps an unreadable file to `''`. The fallback is decided in KD2.                                                                                                                                                                                                                                                                                                          |
| P3  | `stryker-js` has no YAML dependency; `yaml` is in the catalog                                                                                           | Verified                                 | `packages/stryker-js/package.json` lists no `yaml`. `pnpm-workspace.yaml:73` has `yaml: ^2.9.1`. `main.mjs` bundles every non-`node:` import (`packages/stryker-js/tsdown.config.ts:66`) and the library entry does not, so `yaml` belongs in `dependencies`.                                                                                                                                                                                                                                 |
| P4  | Canonical encoding is stable under reorder                                                                                                              | Partly verified; defect found            | `canonicalJsonOf` sorts keys with `localeCompare` (`verdict-semantics.ts:51`). ICU collation can tie distinct keys, and a stable sort then keeps input order, so the result can depend on reorder. R9 fixes this.                                                                                                                                                                                                                                                                             |
| P5  | House standard and packs apply                                                                                                                          | Verified                                 | Packs come from `.compound-engineering/config.yaml`. The ones that apply are listed under Sources.                                                                                                                                                                                                                                                                                                                                                                                            |
| P6  | `basePath` is each mutated project's dir                                                                                                                | Verified                                 | Plan: `plan-request.cell.ts:254-276` (`realPath(resolve(basePath, directory))`). Shard run: `shard/shard-run.ts:101,108` spawns each child with `cwd: projectDir`, and `run/RunEnvironment.service.ts:84` sets `basePath = realPath('.')`. Projects: `.github/workflows/mutation.yml:36`. Every caller of `runInputsDigestOf` passes that `basePath` (`read-project.cell.ts:395`, `mutation-reporting.service.ts:891,982`, `run/incremental-reuse.cell.ts:384`, `run/dry-run-choice.ts:153`). |
| P7  | Main runs the released CLI pinned at `27b107590` (v18.1.0)                                                                                              | Verified; the pin is already stale       | `flake.nix:33-38`. `PUBLISHED_CLI` points at `packages/stryker-js/node_modules/.bin/stryker`, installed from `.sfs-deps` (`mutation.yml:37`, `pnpm-lock.yaml:781-783`). v19.0.0 is tagged (`9e81669b8`, #267) but not pinned. Pin moves are manual PRs (#241, #251); `release.yml` doesn't touch the pin.                                                                                                                                                                                     |

### Key Decisions

- KD1. **A project's closure includes its ancestor importers and every dependency field of each linked importer.** Leaving these out would produce stale verdicts that look valid; including them only costs re-tests, and the probe shows #274 and #266 still don't invalidate anything. Governs R2, R3.
- KD2. **An unusable `pnpm-lock.yaml` falls back to the whole-file digest and logs the reason, rather than failing with a typed error.** The fallback can only cause extra re-tests, never wrong reuse. `runInputsDigestOf` keeps its `never` error channel, so none of its five callers change. A typed failure would make every caller choose what to do anyway, and the only safe choice is to reuse nothing, which is what the whole-file digest already gives. Governs R5, R6.
- KD3. **The closure digest and the whole-file digest are tagged differently.** A closure input can then never hash equal to a whole-file input. Governs R7.
- KD4. **Package metadata is part of each closure node.** Without it, a re-packed local tarball would keep its old digest (P1b). Governs R4.
- KD5. **Canonical encoding uses code-unit key order everywhere.** One convention for `verdict-semantics.ts`; the cache version bump already discards digests made under the old ordering. Governs R9, R10.

### Requirements

**Closure**

- R1. When the nearest lockfile is `pnpm-lock.yaml`, the project's importer key is the directory of its nearest `package.json`, made relative to the lockfile's directory, in POSIX form, with `.` for the lockfile's own directory.
- R2. The closure contains that importer, every ancestor importer up to `.`, and, transitively, every importer reached through a `link:` ref, following all dependency fields (`dependencies`, `devDependencies`, `optionalDependencies`) of each of them.
- R3. A ref becomes a snapshot key by pnpm's `refToRelative` rule, so aliases, peer suffixes, `patch_hash` and `file:` refs each resolve to their own snapshot. From each snapshot the closure follows `dependencies` and `optionalDependencies`, and it terminates on cycles.
- R4. Each closure node contributes its snapshot entry and its `packages` entry (the snapshot key with its peer suffix removed). Each importer contributes its whole entry. `lockfileVersion` and `settings` are included once.

**Fallback**

- R5. `package-lock.json`, `yarn.lock`, `bun.lock` and `bun.lockb` keep today's whole-file input.
- R6. A `pnpm-lock.yaml` falls back to the whole-file input, with one warning naming the reason, when it fails YAML parsing or Schema decoding, has a `lockfileVersion` other than 9.x, has no importer for the project, has no `package.json` above `basePath`, or has a ref with no snapshot.
- R7. The digest input records which form it took, closure or whole-file.

**Encoding and invalidation**

- R8. The lockfile is parsed with `yaml` (a `catalog:` entry in `packages/stryker-js` `dependencies`) and decoded through Schema with strict string fields. No regex or line-based YAML reading.
- R9. The closure is encoded canonically: keys sorted by code unit at every depth, and arrays sorted by key.
- R10. `INCREMENTAL_CACHE_VERSION` moves from `5` to `6`, so no verdict stored under the whole-file meaning is read as a closure-scoped one.

### Acceptance Examples

- AE1. Covers R1, R2. Given the #266 lockfile edit (a new importer `test/checker-parity` that no mutated project links), when each of the four mutated projects is digested before and after, then every digest is unchanged.
- AE2. Covers R3, R4. Given two projects A and B where only A's closure reaches `x@1.0.0`, when `x` moves to `1.0.1`, then A's digest changes and B's doesn't.
- AE3. Covers R4. Given a `file:` tarball ref whose `packages` integrity changes while its key stays the same, then the digest of the project depending on it changes.
- AE4. Covers R2. Given a root importer devDependency that moves, then every project's digest changes.
- AE5. Covers R3. Given a scoped alias, an npm alias and a JSR alias in a project's closure, then each resolves to its target snapshot and the closure has no dangling ref.
- AE6. Covers R9. Given the same lockfile re-serialized with importers, snapshots and keys in another order, then every digest is unchanged.
- AE7. Covers R5. Given a `package-lock.json` project, when an unrelated part of the file changes, then the digest changes.
- AE8. Covers R6, R7. Given a `pnpm-lock.yaml` that fails to parse, or has no importer for the project, then the digest equals the tagged whole-file digest of that text, changes when the text changes, and one warning names the reason.
- AE9. Covers R10. Given a stored report with `incrementalVersion: '5'`, then reuse is refused.

### Scope Boundaries

- No change to `mutation.yml`, the kill matrix, the verdict store, the planner or sharding.
- No closure scoping for npm, yarn or bun lockfiles.
- Not handled: pnpm's hidden hoisting (`node_modules/.pnpm/node_modules`), which can let a dependency load a phantom package outside its declared closure. The lockfile doesn't record hoisting settings and today's digest doesn't cover them.
- No mutation run outside CI. The fix takes effect on main only after the rollout below.

### Rollout

1. The PR merges with a patch changeset for `@systemfsoftware/stryker-js`.
2. The release PR ("version packages", as in #267) merges and tags the release.
3. A manual dogfood PR, following #241 and #251, moves `stryker-published` in `flake.nix`, updates `flake.lock`, and refreshes the `.sfs-deps` integrity in `pnpm-lock.yaml`. Releases and the pin move need operator approval. The pin is at v18.1.0, so this move also takes in v19.0.0's breaking changes (#267).
4. The first main Mutation run after the pin move re-tests everything once, because the engine digest, the cache version and the tarball integrity all change. After that, a lockfile edit outside a project's closure reuses its verdicts.

### Outstanding Questions

- Deferred to Planning: whether the closure decision lives in a new `*.workflow.ts` or as a pure function beside `runInputsDigestOf`. The cell-architecture pack favours a Workflow.
- Deferred to Planning: whether to add a committed, pnpm-generated miniature lockfile as a real-system oracle for the alias, peer-suffix and `patch_hash` key forms.

### Sources

- Packs: (pack: cell-architecture, pure-decision-workflows.md) for the closure decision; (pack: cell-architecture, decode-never-cast.md) for the R8 decode; (pack: schema-laws, rich-type-over-foreign-encoded.md), since the pnpm lockfile is a foreign wire shape; (pack: schema-laws, tests-own-no-schemas.md), so tests draw from the production lockfile schema; (pack: boundary-testing, pin-dependency-semantics.md) for the `yaml` parse behaviour and pnpm's ref rule.
- pnpm `refToRelative` rule: `@pnpm/dependency-path`.
