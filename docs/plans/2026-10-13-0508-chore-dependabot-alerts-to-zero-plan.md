---
title: Bring main to zero Dependabot alerts by removing what does not belong and bumping what does - Plan
type: chore
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-13-0440-chore-dependabot-alerts-to-zero-plan.md
---

# Bring main to zero Dependabot alerts by removing what does not belong and bumping what does - Plan

## Goal Capsule

- **Objective:** main carries no open Dependabot alert, with no alert dismissed, no Dependabot ignore rule, and no unexplained pnpm override.
- **Authority:** operator order of 2026-10-13: "main must reach zero open Dependabot alerts without dismissing alerts, adding dependabot ignore rules, or adding unexplained pnpm overrides. Remove dependencies and reference material that do not belong; update dependencies that do belong." and "first remove [the `effect` subtree under `repos/`] and repoint every docs/plans citation to the source this repo actually installs or to upstream permalinks at the pinned tag; then handle root-lock alerts by removing unused parents or bumping direct parents to patched releases."
- **Means:** one small PR per unit, one open at a time, in the order U1, U2, U3.
- **Open blockers:** R9 needs a human decision before U3 can close the last alert (KTD8).
- **Non-goals:** `test/e2e-core`, `.github/workflows/mutation.yml`, `.github/workflows/kill-matrix.yml`, the `constitution` and `worktrunk-scripts` subtrees, other repositories. No new third-party package without a human decision.

---

## Product Contract

### Summary

Delete the vendored `effect` subtree, which nothing builds or installs and which owns 28 of the 43 alerts. Then clear the 15 root-lock alerts by deleting dead declarations, bumping the one direct parent with a patched release, and refreshing transitive pins inside their existing ranges. The one alert with no patched release goes to a human with the options and evidence.

### Problem Frame

The Dependabot alerts list is unreadable to the agent's token: REST `dependabot/alerts` answers 403 and GraphQL `vulnerabilityAlerts` reports 0 while `hasVulnerabilityAlertsEnabled` is true. The inventory below is reconstructed from the lockfiles at `25120175` and the reviewed npm advisories of the GitHub Advisory Database (KTD1).

| Manifest                                                    | Alerts | Packages                                                                                                                                                           |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm-lock.yaml` inside the `effect` subtree under `repos/` | 28     | undici (10), brace-expansion 1.1.16 (5), stream-json (3), image-size (2), seroval (2), sprintf-js, shell-quote, source-map-js, braces, sharp, serialize-javascript |
| root `pnpm-lock.yaml`                                       | 15     | devalue 5.9.2 (6), brace-expansion 5.0.9 (3), @grpc/grpc-js 1.14.4 (2), shell-quote 1.9.0 (critical), fast-uri 3.1.7, source-map-js 1.2.1, sprintf-js 1.0.3        |
| `test/e2e/testResources/*/package-lock.json` (7)            | 0      | none                                                                                                                                                               |

The subtree is a squash of upstream `Effect-TS/effect` at `effect@4.0.0-rc.117`. The workspace installs `effect@4.0.0`, whose npm package ships `src/`. The subtree is outside the pnpm workspace globs, and no build, test, lint, CI job, hook, or script reads it. Eight lines in six plans cite paths inside it.

### Requirements

**Reference material**

- R1. The `effect` subtree and its `subtrees.toml` entry are gone from main, so no future subtree pull re-adds it.
- R2. Every docs citation that resolved only through the subtree resolves to an upstream commit permalink at the release it was verified against, or to the installed package where the citation is about current behavior.
- R3. No committed file, lockfiles and fixture snapshots included, names the removed subtree path afterwards (DEL1).

**Root lockfile**

- R4. Dependencies that a workspace manifest declares but no source, config, or script uses are deleted from that manifest.
- R5. A direct parent that pins a vulnerable version exactly is bumped to a release that pins a patched one.
- R6. A transitive vulnerable pin whose parent's range already admits a patched release is refreshed with a name-scoped update; no catalog entry or specifier changes for it.
- R7. A refresh moves no package outside the named set, and regenerates no `etc/*.api.md` report.

**Evidence and escalation**

- R8. Each PR body gives the alert count before and after, `pnpm why` for every removed parent, and each closed alert mapped to the commit that closes it.
- R9. An alert with no patched release is cleared by removing or replacing its parent, or escalated to a human with the upstream issue link before the unit proceeds.

### Key Decisions

- **Permalinks over the installed package for historical citations.** A plan's line numbers were verified against the subtree at that commit; a permalink at that release keeps them true, while `effect@4.0.0` moves them and `@effect/vitest` is not installed. Governs R2.
- **Delete the subtree rather than resync it.** A resync to `effect@4.0.0` keeps upstream's own lockfile alerts and goes stale on the next release. Deleting only its lockfile leaves a tree that no longer matches upstream. The local Effect reference becomes the installed package, which ships `src/` and `ai-docs/` at the version the workspace runs. Governs R1.
- **The subtree's `subtrees.toml` entry goes with it.** `AGENTS.md` lists `subtrees.toml` and `repos/**` as read-only. The operator ordered the subtree removed, and an entry left behind would re-add the subtree on the next pull. The PR declares this edit. Governs R1.

### Scope Boundaries

- Alerts outside npm (GitHub Actions pins under the read-only `.github/workflows/`) and malware or unreviewed advisories are outside the reconstruction; none matches today.
- The two `packages/stryker-js/tests/__fixtures__/lockfile-closure/real/pnpm-lock.<sha>.yaml` snapshots are not Dependabot manifests and stay as frozen fixtures.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The alert count is reconstructed from lockfiles and advisories.** Parse each Dependabot-scanned npm lockfile, query `GET /advisories?ecosystem=npm&affects=<names>` for reviewed, non-withdrawn advisories, and match versions with semver. `GET /repos/{repo}/dependency-graph/compare/{base}...{head}` reads manifests only: for U1 it lists the removed subtree `package.json` entries with no vulnerabilities, because the subtree lockfile is not one of its inputs, so it corroborates the removal, not the alert count. A token with Dependabot read access is the only reader of the alerts list itself. Governs R8.
- KTD2. **Each citation is anchored by blame.** The release a citation was verified against is the subtree version in the tree of the commit that wrote the line: `effect@4.0.0-rc.116` (`d62dd0d65252e5d3635538f0e41adc7c08aa9beb`) for the plans of 2026-09-21 and 2026-09-23, `effect@4.0.0-rc.117` (`14a3f140095fdebbff9162944fe7d4ea83e054e6`) for the later four. Both SHAs equal the upstream tags and the `git-subtree-split` trailers of the squash commits `6315eb9e` and `a07187c6`, the second parents of the subtree merges `57044e93` and `9a16f8ec`. Bare file names in the same sentences (`Cause.ts:77`, `Effect.ts:13535`) are citations into the subtree too. Prose that pointed at the vendored source as the live reference (the mutant-quality plan's KTD11) points at the installed package instead. Governs R2.
- KTD3. **U1 is two commits.** The docs repoint lands first; the subtree deletion and its `subtrees.toml` entry land second, so on the PR branch all 28 subtree alerts map to the deletion commit. A squash merge folds both into the PR's merge commit on main, which then closes all 28. Governs R1, R8.
- KTD4. **U2's removals are proven dead before deletion.** `@opentelemetry/sdk-node` is declared by `stryker-js-typescript-checker` and `stryker-js-vitest-runner` and imported by neither (the only `NodeSDK` import is `packages/toolchain/vitest-config/lib/otel.js:3`); both bundles set `deps.alwaysBundle: [/./]`, and neither `inlinedDependencies` lists it. `concurrently` is declared by `stryker-js` and `stryker-js-vitest-runner` and invoked by neither. Governs R4.
- KTD5. **U2 bumps `concurrently` to 10.0.6.** 10.0.5 pins `shell-quote` 1.9.0 exactly; 10.0.6 pins 1.12.0. It stays a dependency: root `prepare` and `packages/ignorers/kit` `api:check` run it. Governs R5.
- KTD6. **U2's refresh is `pnpm update` over exact names.** brace-expansion (minimatch `^5.0.2`), fast-uri (ajv `^3.0.1`), devalue (svelte `^5.8.1`), source-map-js, and @grpc/grpc-js (otlp-grpc-exporter-base `^1.14.3`) all reach patched releases inside their parents' ranges. The diff may touch only `pnpm-lock.yaml` plus the four manifest edits of KTD4 and KTD5. Governs R6, R7.
- KTD7. **U2 rebuilds both plugin packages.** tsdown writes `inlinedDependencies` into their manifests; a moved version is committed, not left stale. The live-lock scenario of `packages/stryker-js/tests/lockfile-closure-digest.integration.test.ts` must stay green; a new reason code there means regenerating the oracle with `pnpm --filter @systemfsoftware/stryker-js fixtures:lockfile-oracle`. Governs R7.
- KTD8. **sprintf-js is escalated, not routed around.** Every published sprintf-js is affected (GHSA-hp3w-g68c-fv3c, through 1.1.3). It arrives through `@microsoft/api-extractor` (exact pin of `@rushstack/ts-command-line` 5.3.17, latest) and `argparse ~1.0.9`. api-extractor runs the `api:check` report gate of 17 packages, so replacing or removing it edits a judgment surface (CONST-E9), and an override to argparse 2 would be an unexplained override with an incompatible API. The precondition is attacker-controlled format strings, which argparse's own help templates are not. Upstream tracks dropping argparse in microsoft/rushstack#5090 (open); its argparse 2 update, microsoft/rushstack#4403, closed unmerged. The human chooses among waiting for upstream, replacing the report gate, or another route. Governs R9.

---

## Implementation Units

### U1. Delete the vendored `effect` subtree

- **Goal:** the 28 subtree alerts close, and every plan citation still resolves.
- **Requirements:** R1, R2, R3, R8.
- **Files:** the six plans `docs/plans/2026-09-21-0025-feat-v8-vm-vitest-runner-compatibility-plan.md`, `docs/plans/2026-09-23-1903-feat-effect-concurrency-mutators-plan.md`, `docs/plans/2026-09-26-0550-refactor-idiomatic-effect-rewrite-plan.md`, `docs/plans/2026-10-13-0410-feat-mutant-quality-plan-v3.md` (main renamed it from `2026-10-09-1850-feat-mutant-quality-plan.md` in #290), `docs/plans/2026-10-10-1719-perf-execution-engine-bench-lane-plan.md`, `docs/plans/2026-10-11-1203-fix-e2e-locked-fixtures-plan.md`; `subtrees.toml`; the subtree directory; this plan.
- **Approach:** repoint per KTD2 in one commit; `git rm -r` the subtree and delete its `subtrees.toml` entry in a second (KTD3).
- **Verification:** `git grep -nI -e 'repos/effec[t]'` exits 1 with no pathspec exclusions; every permalink's cited line holds the cited symbol at its release; `pnpm install --frozen-lockfile` and `pnpm check:ci` pass; the dependency-graph compare for the PR lists the subtree manifests as removed.

### U2. Clear the root-lock alerts that have a patched release

- **Goal:** 14 root alerts close.
- **Requirements:** R4, R5, R6, R7, R8.
- **Dependencies:** U1 merged.
- **Files:** `packages/stryker-js-typescript-checker/package.json`, `packages/stryker-js-vitest-runner/package.json`, `packages/stryker-js/package.json`, `pnpm-lock.yaml`, `.changeset/*.md` for the three published packages.
- **Approach:** delete the dead declarations (KTD4), bump `concurrently` (KTD5), run the name-scoped refresh (KTD6), rebuild the two plugin packages (KTD7).
- **Verification:** `pnpm why` for each package shows the patched version only; `pnpm check:ci` passes; `git diff --stat` touches no file outside the list; the dependency-graph compare lists the 14 alerts as removed.

### U3. Resolve sprintf-js

- **Goal:** the last root alert closes by the route the human picks.
- **Requirements:** R9.
- **Dependencies:** the human decision of KTD8.
- **Approach:** set by that decision.

---

## Verification Contract

| Gate                                 | Command                                                                                                                                                                                | Units      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Formatting                           | `pnpm format:check`                                                                                                                                                                    | U1, U2     |
| Typecheck, tests, build, api reports | `pnpm check:ci`                                                                                                                                                                        | U1, U2     |
| Changeset intent                     | the `Changeset Check` workflow (`.github/workflows/changeset-check.yml`) on the PR                                                                                                     | U1, U2     |
| Dogfood install                      | `nix build .#stryker-published --out-link .sfs-deps && pnpm install --frozen-lockfile`                                                                                                 | U1, U2     |
| Removal is total                     | U1: `git grep -nI -e 'repos/effec[t]'` exits 1, no exclusions. U2: no edited `package.json` declares a removed dependency, and `pnpm why -r <name>` shows no edge from those importers | U1, U2     |
| Alerts closed                        | the alert count on main after merge, read with Dependabot access (KTD1)                                                                                                                | U1, U2, U3 |
