---
title: E2E Fixture Locks Pinned To The Repo's Resolution - Plan
type: fix
date: 2026-10-12
topic: e2e-catalog-pin
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# E2E Fixture Locks Pinned To The Repo's Resolution - Plan

## Goal Capsule

- **Objective:** The e2e lane tests the packed workspace code against the same third-party versions the repo builds and unit-tests it with, including after anyone regenerates a fixture lock. A fresh registry resolution must never change those versions.
- **Means:** one follow-up PR. Regeneration pins the closure members' own `catalog:` dependencies with scoped npm overrides. Fixtures stage their own `catalog:` references at `pnpm-lock.yaml`'s versions. A check over the committed locks enforces the invariant.
- **Product authority:** the root's catalog-pin outcome (2026-10-12): wherever a fixture lock and `pnpm-lock.yaml` resolve the same package they record the same version, and regeneration takes versions from `pnpm-lock.yaml`, never from a range. That outcome is refined here: the invariant covers the packages whose versions the repo pins on purpose (R1); KD1 records why it does not cover every shared name. #311 (`ddeb67ab5`) owns the bake; this follow-up starts only after the root lifts the freeze on the fixture install.
- **Open blockers:** the root's freeze on fixture-install changes while main's e2e is under watch (2026-10-12).

---

## Product Contract

### Summary

Add one follow-up of about 140 hand-written lines. It makes `fixtures:lock` take every closure member's catalog dependency, and every fixture's own catalog reference, from `pnpm-lock.yaml`. A check makes a lock that drifts from those versions fail `check` on the PR that commits it. The bake stays one `npm ci` per fixture from its committed lock, with no cap, retry, `--legacy-peer-deps` or `--force`.

### Problem Frame

A fresh npm resolution of `^4.0.0` picked `@effect/platform-node@4.0.3`, which required an `effect@^4.0.3` that was not yet published, and every e2e bake hung. #311 removed resolution from the bake: each fixture installs with `npm ci` from a committed lock (`test/e2e/tests/__fixtures__/bake-fixtures.sh`). Resolution still happens in one place, the regeneration script (`pnpm --filter @systemfsoftware/stryker-e2e fixtures:lock`). It stages each fixture and runs `npm install --package-lock-only` (`test/e2e/src/Harness/fixture-cache.service.ts:114`, `:721-745`).

Measured on `ddeb67ab5`:

- All seven committed locks record `effect`, `@effect/platform-node` and `@effect/platform-node-shared` at 4.0.0. No top-level catalog package differs from its `pnpm-lock.yaml` catalog version.
- Both `effect@4.0.3` and `@effect/platform-node@4.0.3` are now published and tagged `latest` (`npm view`, 2026-10-12). A from-scratch regeneration today no longer hangs; it resolves 4.0.3 silently. The fixture would then exercise the packed code against an `effect` the repo never built or tested, and the e2e legs, now postsubmit, would be the first and only place that shows it.
- In-place regeneration over the committed locks changes no package: npm keeps every locked version that still satisfies its range (scratch run at `534bfb03d`, 2026-10-11). Drift enters only with a lock that is deleted or new, or a dependency name the lock has not seen. Open #287 adds one such lock, `diff-scope-fixture`; it records 4.0.0 today.
- The strict reading of the invariant is already false, and harmlessly so. Of the 242 package names that both the fixture locks and `pnpm-lock.yaml` resolve, 53 differ in version (263 lock entries). All 53 are third-party transitives, such as jsdom's CSS stack, redis and rolldown 1.2.13 against the repo's 1.2.8. The only catalog name among them is `@oxc-project/types` 0.153.0, nested under rolldown, which pins it exactly (`=0.153.0`).

The scratch build at `534bfb03d` added global npm overrides for every catalog name, then for the closure members' names only. Both forced rolldown's nested `@oxc-project/types` to 0.150.0. A from-scratch run also failed its own check on `@types/node` 26.6.5 (repo 24.13.3) and `@types/estree` 1.0.9 (repo 1.0.8), transitive names that neither the overrides nor the fixtures pin.

### Requirements

**The invariant**

- R1. In every committed fixture lock, each `catalog:` dependency that a packed closure member declares (`dependencies`, `optionalDependencies` or `peerDependencies`), and each `catalog:` reference in the fixture's own manifests, resolves from the member's or fixture's location to the version `pnpm-lock.yaml`'s `catalogs.default` records for that name.
- R2. A catalog name that `pnpm-lock.yaml` does not resolve, such as the svelte fixture's `vite`, `@sveltejs/vite-plugin-svelte` and `@testing-library/svelte`, keeps its `pnpm-workspace.yaml` range and is outside R1.
- R3. A third-party package's own exact pin keeps its version. rolldown's `=0.153.0` on `@oxc-project/types` stays 0.153.0 in every lock.

**Regeneration**

- R4. `fixtures:lock` takes the R1 versions from `pnpm-lock.yaml`, never from a range or from a leftover lock. This holds both in place and from scratch, with every lock deleted.
- R5. Regeneration from scratch and in place both finish without a hang. Each fixture's lock satisfies R1 and R3.

**The bake**

- R6. The bake stays one `npm ci` per fixture from its committed lock, with no timeout, kill cap, age gate, retry, second install, `--legacy-peer-deps` or `--force`.
- R7. Bake and regeneration stage each fixture's own manifests identically, so `npm ci` accepts every lock the regeneration commits.

**Enforcement**

- R8. A check that `check` runs on every PR fails, naming the fixture, the package, the locked version and the `pnpm-lock.yaml` version, whenever a committed lock breaks R1 or R3.
- R9. The follow-up adds about 250 hand-written lines or fewer, excluding generated `package-lock.json` files and `docs/plans`.

### Key Decisions

- **The invariant covers what the repo pins on purpose, not every shared name.** Pinning all 242 shared names means overriding 53 third-party transitives. It would also force rolldown to 1.2.8, and it needs `pnpm-lock.yaml`'s dependency graph to place names that pnpm holds at several versions (33 such names, 5 among the 53). It costs about 250-400 lines [INFERENCE: sized from the scratch build's 136 for 18 names plus graph parsing], and buys nothing the harm needs. The 4.0.3 failure was a closure member's own catalog edge. Governs R1, R2, R3.
- **Overrides are scoped to each closure member and live in regeneration only.** npm's override for a parent package reaches that package's whole subtree, peers included. It leaves a sibling's own exact pin alone: in a scratch probe, `debug@4.3.4` kept its pinned `ms@2.1.2` beside an override that set `ms` to 2.0.0 under the member. A lock written with overrides also installs unchanged under `npm ci` without them (exit 0, overridden versions installed). So the bake's staged manifest carries no overrides. Governs R3, R4, R6.
- **A fixture's own `catalog:` references are staged at `pnpm-lock.yaml`'s exact versions, in bake and regeneration alike.** npm refuses an override on a direct dependency unless the specs match exactly (`EOVERRIDE`; npm docs, `overrides`), so a range like `^4.0.0` would still resolve fresh from scratch. Exact specs change each lock's root entry once, from ranges to versions, and the bake key once. Governs R1, R7.
- **The check follows resolution, not top-level names.** A top-level-name check fails a from-scratch lock on `@types/node`, a transitive that nothing pins (scratch run at `534bfb03d`). A check that follows R1's edges from each member and from the fixture root tests exactly what the mechanism promises. Governs R8.
- **The follow-up exists.** Doing nothing costs 0 lines, but the next from-scratch lock silently tests the packed code against `effect@4.0.3`. A check without the pin costs about 75 lines and makes that lock fail `check`, yet leaves regeneration resolving from ranges, and the author would have to hand-edit a generated lock. Governs R4, R8.

### Approaches compared

| Approach                                                                  |        Hand-written lines | Keeps rolldown's pin           | Regeneration from `pnpm-lock.yaml` | Bake unchanged                            | Verdict                                                             |
| ------------------------------------------------------------------------- | ------------------------: | ------------------------------ | ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| A. Nothing                                                                |                         0 | yes                            | no                                 | yes                                       | Rejected: the next new or deleted lock resolves 4.0.3 silently      |
| B. Check only                                                             |                  about 75 | yes                            | no                                 | yes                                       | Rejected: catches drift, then leaves the author hand-editing a lock |
| C. Global overrides for every catalog name (scratch `003e16423`)          |                        94 | no                             | from scratch only                  | no, overrides staged in the bake          | Rejected: breaks rolldown's pin; check fails from scratch           |
| D. Global overrides for closure members' names (scratch `534bfb03d`)      |                       136 | no                             | yes                                | no, overrides staged in the bake          | Rejected: still overrides rolldown's pin; check fails from scratch  |
| E. Scoped overrides in regeneration, exact fixture refs, resolution check |     about 140 [INFERENCE] | yes                            | yes                                | npm ci unchanged; staged root specs exact | **Chosen**                                                          |
| F. Every shared name pinned to `pnpm-lock.yaml`                           | about 250-400 [INFERENCE] | rolldown itself moves to 1.2.8 | yes                                | no                                        | Rejected: R9, and the harm does not need it                         |

E's estimate: `pnpm-lock.yaml` catalog parser 9 lines, scoped overrides plus resolution check about 45, harness wiring in `lockFixtures` and the catalog source about 30, the committed-lock check test about 45, docs about 10. All but the harness figure are measured on `534bfb03d`.

### Acceptance Examples

- AE1. Covers R4, R5. **Given** every fixture lock deleted in a scratch copy, **when** `fixtures:lock` runs, **then** it finishes without a hang, and every lock records `effect`, `@effect/platform-node` and `@effect/platform-node-shared` at 4.0.0 although 4.0.3 is `latest` on the registry.
- AE2. Covers R3. **Given** that from-scratch run, **when** a lock is read, **then** `node_modules/rolldown`'s `@oxc-project/types` resolves to 0.153.0, while each closure member that declares it as `catalog:` resolves 0.150.0.
- AE3. Covers R4. **Given** the committed locks, **when** `fixtures:lock` runs in place, **then** no package version changes.
- AE4. Covers R8. **Given** a scratch copy of one lock with `effect` hand-bumped to 4.0.3, **when** the check runs, **then** it fails naming the fixture, `effect`, 4.0.3 and 4.0.0; with the lock restored, it passes.
- AE5. Covers R6, R7. **Given** calc-fixture and svelte-app-fixture staged the bake's way from the regenerated locks, **when** `npm ci` runs, **then** it exits 0 and `node_modules/.bin/stryker` is linked.

### Scope Boundaries

- No change to the bake's install command, its count, or any cap (R6).
- Third-party transitive versions that differ from `pnpm-lock.yaml` (53 names today) stay as npm resolves them.
- Catalog names that `pnpm-lock.yaml` does not resolve are not added to a workspace importer (R2).
- No schema or decoder for npm's lock format beyond the fields the check reads. Whether to keep that exemption is a planning question (Q2).
- No automatic regeneration in CI; locks stay committed by the author who changes a fixture or a closure member's dependencies.

### Outstanding Questions

**Resolve Before Planning**

- Q1. When the root lifts the fixture-install freeze, does this land as its own PR off main (recommended), or wait for another fixture change to ride with?

**Deferred to Planning**

- Q2. Whether the lock fields the check reads (`packages`, `version`, `resolved`, edge maps) get a minimal Effect Schema. The plan that #311 implemented chose none (`docs/plans/2026-10-11-1203-fix-e2e-locked-fixtures-plan.md`, KTD1), and the schema-laws pack rule `rich-type-over-foreign-encoded.md` flagged that choice in #311's pack assessment.
- Q3. How the check walks node resolution from a member's lock path (nearest `node_modules` up the tree), and its test layer: a property test for the pure walk, and one in-process integration test over the committed files.
- Q4. Whether `fixtures:lock` should refuse to write a lock that breaks R1, in addition to R8's check.

### Sources / Research

- Main at `ddeb67ab5`: `test/e2e/tests/__fixtures__/bake-fixtures.sh`, `test/e2e/src/Harness/fixture-cache.service.ts` (`LOCK_ONLY_INSTALL` at `:114`, `stageClosure` at `:272`, `stageFixtures` at `:287`, `lockFixtures` at `:721`), `test/e2e-core/src/closure-lock.ts`, `pnpm-lock.yaml` (`catalogs.default`, 59 names).
- Scratch measurements on local branch `scratch/catalog-pin`, cut from #311's pre-squash head `4696b2199`: `003e16423` (global catalog overrides, 94 added lines) and `534bfb03d` (closure-member overrides, 136 added lines, in-place and from-scratch runs).
- npm 11.19.0 scratch probes in `/tmp`, 2026-10-12: parent-scoped override applies to the member's dependency and peer edges; a sibling's exact pin survives; `npm ci` without overrides installs a lock written with them.
- npm `overrides` documentation, package.json reference: <https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides> (parent-scoped overrides; `EOVERRIDE` on a direct dependency whose spec differs).
- Registry, 2026-10-12: `effect` and `@effect/platform-node` `latest` = 4.0.3; `@effect/platform-node@4.0.3` peers `effect@^4.0.3`.
- Open #287 (`stryker/mutant-quality-l2-diff-plan`) adds `test/e2e/testResources/diff-scope-fixture/package-lock.json`.
