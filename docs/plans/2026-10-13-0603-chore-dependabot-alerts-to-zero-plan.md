---
title: Bring main to zero Dependabot alerts by removing what does not belong and bumping what does - Plan
type: chore
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-13-0556-chore-dependabot-alerts-to-zero-plan.md as of 3330c31f (each earlier revision of this plan was renamed to the next dated file on this branch; `git show 3330c31f:docs/plans/2026-10-13-0556-chore-dependabot-alerts-to-zero-plan.md` reads it)
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
- R2. Every docs citation that resolved only through the subtree resolves to an upstream commit permalink at the release it was verified against, or, where the citation is about current behavior, to an upstream permalink at the `effect` version `pnpm-lock.yaml` locks.
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
- **Delete the subtree rather than resync it.** A resync to `effect@4.0.0` keeps upstream's own lockfile alerts and goes stale on the next release. Deleting only its lockfile leaves a tree that no longer matches upstream. The local Effect reference becomes the locked `effect` package, which ships `src/` and `ai-docs/` under `node_modules`, and committed citations link upstream at the locked tag. Governs R1.
- **The subtree's `subtrees.toml` entry goes with it.** `AGENTS.md` lists `subtrees.toml` and `repos/**` as read-only. The operator ordered the subtree removed, and an entry left behind would re-add the subtree on the next pull. The PR declares this edit. Governs R1.

### Scope Boundaries

- Alerts outside npm (GitHub Actions pins under the read-only `.github/workflows/`) and malware or unreviewed advisories are outside the reconstruction; none matches today.
- The two `packages/stryker-js/tests/__fixtures__/lockfile-closure/real/pnpm-lock.<sha>.yaml` snapshots are not Dependabot manifests and stay as frozen fixtures.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The alert count is reconstructed from lockfiles and advisories.** Parse each Dependabot-scanned npm lockfile, query `GET /advisories?ecosystem=npm&affects=<names>` for reviewed, non-withdrawn advisories, and match versions with semver. `GET /repos/{repo}/dependency-graph/compare/{base}...{head}` reads manifests only: for U1 it lists the removed subtree `package.json` entries with no vulnerabilities, because the subtree lockfile is not one of its inputs, so it corroborates the removal, not the alert count. A token with Dependabot read access is the only reader of the alerts list itself. Governs R8.
- KTD2. **Each citation is anchored by blame.** The release a citation was verified against is the subtree version in the tree of the commit that wrote the line: `effect@4.0.0-rc.116` (`d62dd0d65252e5d3635538f0e41adc7c08aa9beb`) for the plans of 2026-09-21 and 2026-09-23, `effect@4.0.0-rc.117` (`14a3f140095fdebbff9162944fe7d4ea83e054e6`) for the later four. Both SHAs equal the upstream tags and the `git-subtree-split` trailers of the squash commits `6315eb9e` and `a07187c6`, the second parents of the subtree merges `57044e93` and `9a16f8ec`. Bare file names in the same sentences (`Cause.ts:77`, `Effect.ts:13535`) are citations into the subtree too. Prose that pointed at the vendored source as the live reference (the mutant-quality plan's KTD11) now names the version `pnpm-lock.yaml` locks and links the `effect` sources upstream at the `effect@4.0.0` tag (`67ba4e46a11ccda0b6761578bfd22c04ae00167d`). Governs R2.
- KTD3. **U1 changes the tree in two commits.** The docs repoint lands first and the subtree deletion with its `subtrees.toml` entry second, so no commit on the branch deletes the subtree while a plan still cites it, and on the branch all 28 subtree alerts map to the deletion commit. Later commits on the branch edit plan text only, and the Removal is total gate holds on each of them. The repository allows merge commits, squash, and rebase. A merge commit or rebase keeps the deletion commit on main, and it closes the 28; a squash folds the branch into one commit that closes the 28. Governs R1, R8.
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
- **Verification:** the Removal is total, Prose references, and Citations resolve gates of the Verification Contract. `pnpm install --frozen-lockfile` and `pnpm check:ci` show only that the deletion broke nothing: the subtree sat outside the workspace globs, so neither can fail on a wrong citation. The dependency-graph compare for the PR lists the subtree manifests as removed. The 28-alert closure is reconstructed (KTD1), not observed: it is confirmed only by the Alerts closed gate, on main after merge, by a token with Dependabot read access, which the author does not hold.

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

| Gate                                 | Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Units      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Formatting                           | `pnpm format:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | U1, U2     |
| Typecheck, tests, build, api reports | `pnpm check:ci`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | U1, U2     |
| Changeset intent                     | the `Changeset Check` workflow (`.github/workflows/changeset-check.yml`) on the PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | U1, U2     |
| Dogfood install                      | `nix build .#stryker-published --out-link .sfs-deps && pnpm install --frozen-lockfile`                                                                                                                                                                                                                                                                                                                                                                                                                                                               | U1, U2     |
| Removal is total                     | U1: the script below exits 0, with no `FAIL` line from checks 0-2. U2: no edited `package.json` declares a removed dependency, and `pnpm why -r <name>` shows no edge from those importers                                                                                                                                                                                                                                                                                                                                                           | U1, U2     |
| Prose references                     | U1: check 3 passes: every line outside this plan that names a vendored or subtree `effect` also cites the installed `node_modules/.pnpm/effect@<version>` package or the `dprint.json` exclude                                                                                                                                                                                                                                                                                                                                                       | U1         |
| Citations resolve                    | U1: check 4 passes: each Effect-TS permalink the branch adds pins the commit of an `effect@` tag its line names, resolves upstream, keeps its `#L` anchor inside the file, and every `` `symbol` N `` or `` `symbol` (N) `` pair cited against that file holds the symbol at line N. By hand: for the rc.116 and rc.117 links the upstream object equals `<path>` in the squash commit (`6315eb9e` for rc.116, `a07187c6` for rc.117). Line numbers are true at the release named beside them; the locked `effect@4.0.0` may number them differently | U1         |
| Alerts closed                        | the alert count on main, read with Dependabot access (KTD1) once the dependency graph shows the merge commit, since Dependabot retires an alert only when it rescans the manifest                                                                                                                                                                                                                                                                                                                                                                    | U1, U2, U3 |

The U1 script, kept out of the table so that no pipe is escaped. Run it with `bash`; it prints a `FAIL` line for every failed check and exits 1 if any failed. Nothing in it is a count or list copied from this plan: each check derives its expectation from the deleted tree at `25120175`, from upstream tags, or from the cited files.

```bash
fail=0
bad() { echo "FAIL: $*"; fail=1; }
prefixes() { awk -F/ '{p=$1; print p; for (i = 2; i <= NF; i++) { p = p "/" $i; print p }}'; }
# check 0
test -z "$(git ls-files repos | grep '^repos/effec[t]/')" || bad 'subtree files tracked'
! git grep -qE '^name = "effec[t]"' -- subtrees.toml || bad 'subtrees.toml entry'
# check 1
! git grep -nI -e 'repos/effec[t]' || bad 'literal subtree path'
# check 2: paths that existed only in the deleted subtree, written relative to its root
only="$(comm -23 <(git ls-tree -r --name-only 25120175:repos/"effect" | prefixes | grep / | sort -u) <(git ls-files | prefixes | sort -u))"
toks="$(git grep -hI '' | sed -E 's#\[[^]]*\]\(https://github\.com/Effect-TS/effect/(blob|tree)/[0-9a-f]{40}/[^)]*\)##g' | grep -oE '[A-Za-z0-9_.@-]+(/[A-Za-z0-9_.@-]+)+' | sort -u)"
hits="$(comm -12 <(printf '%s\n' "$only") <(printf '%s\n' "$toks"))"
test -z "$hits" || bad "paths relative to the subtree: $hits"
# check 3
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  printf '%s\n' "$hit" | grep -qE 'node_modules/\.pnpm/effect@|dprint\.json' || bad "prose: $hit"
done <<< "$(git grep -nIiE 'vendored[^.]{0,60}effec[t]|subtree[^.]{0,30}effec[t]|effect[^.]{0,20}subtree' | grep -v 'chore-dependabot-alerts-to-zero-plan\.md:')"
# check 4. BASE: the merge base before landing; after landing, the main commit before the PR's
# first commit. Annotated tags resolve through their peeled ^{} line.
BASE="$(git merge-base origin/main HEAD)"
tags="$(git ls-remote --tags https://github.com/Effect-TS/effect 'effect@*' | sed -E 's#\^\{\}$##')"
url_re='https://github.com/Effect-TS/effect/(blob|tree)/[0-9a-f]{40}/[^) `]+'
while IFS= read -r line; do
  [ -z "$line" ] && continue
  urls="$(printf '%s\n' "$line" | grep -oE "$url_re")"
  npaths="$(printf '%s\n' "$urls" | sed -E 's/#.*//' | sort -u | wc -l)"
  for u in $(printf '%s\n' "$urls" | sort -u); do
    kind="$(printf '%s' "$u" | sed -E 's#^https://github.com/Effect-TS/effect/(blob|tree)/.*#\1#')"
    sha="$(printf '%s' "$u" | sed -E 's#^https://github.com/Effect-TS/effect/(blob|tree)/([0-9a-f]{40})/.*#\2#')"
    path="$(printf '%s' "$u" | sed -E 's#^https://github.com/Effect-TS/effect/(blob|tree)/[0-9a-f]{40}/([^#]*).*#\2#')"
    tag="$(printf '%s\n' "$tags" | awk -v s="$sha" '$1 == s { sub("refs/tags/", "", $2); print $2; exit }')"
    if [ -z "$tag" ]; then bad "$u pins no effect@ tag"; continue; fi
    printf '%s\n' "$line" | grep -qF "\`$tag\`" || bad "$u: \`$tag\` is not named on its line"
    gh api "repos/Effect-TS/effect/contents/$path?ref=$sha" --silent || { bad "$u: path missing"; continue; }
    [ "$kind" = blob ] || continue
    body="$(gh api "repos/Effect-TS/effect/contents/$path?ref=$sha" -H 'Accept: application/vnd.github.raw')"
    last="$(printf '%s' "$u" | grep -oE '#L[0-9]+(-L[0-9]+)?$' | grep -oE '[0-9]+$')"
    if [ -n "$last" ] && [ "$last" -gt "$(printf '%s\n' "$body" | wc -l)" ]; then bad "$u: anchor past end of file"; fi
    if [ "$npaths" -eq 1 ]; then seg="$line"; else seg="${line#*"$u"}"; seg="${seg%%https://github.com/Effect-TS/effect/*}"; fi
    while read -r sym n; do
      [ -z "$sym" ] && continue
      printf '%s\n' "$body" | sed -n "${n}p" | grep -qE "(^|[^A-Za-z0-9_])$sym([^A-Za-z0-9_]|\$)" || bad "$u: line $n does not hold $sym"
    done <<< "$(printf '%s\n' "$seg" | grep -oE '`[A-Za-z_][A-Za-z0-9_]*` \(?[0-9]{2,6}' | sed -E 's#`([^`]+)` \(?([0-9]+)#\1 \2#')"
  done
done <<< "$(git diff "$BASE" HEAD -- docs | grep '^+' | grep -E "$url_re")"
exit "$fail"
```
