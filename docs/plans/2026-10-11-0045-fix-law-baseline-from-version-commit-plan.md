---
title: Contract version law reads its released baseline from the version commit - Plan
type: fix
date: 2026-10-11
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Contract version law reads its released baseline from the version commit - Plan

## Goal Capsule

- **Objective:** A release can never leave main red on the contract version law, and the law still refuses every contract narrowing that main's declared version does not cover.
- **Means:** the law reads the released version and the released contract documents from git, at the commit that set main's declared version, instead of from the pinned `.sfs-deps` tarballs (KTD1, KTD2).
- **Authority:** `CONSTITUTION.md`, then root `AGENTS.md`, then this plan. Where this plan and `docs/solutions/tooling-decisions/released-baseline-law-refuses-a-lagging-pin.md` disagree, this plan wins and U3 rewrites the solution doc.
- **Stop conditions:** stop and report if a falsification probe in the Verification Contract stays green against its broken variant, or if the version-commit lookup for both packages takes more than 60 s in CI's checkout shape.
- **Execution profile:** one PR off `origin/main` on `fix/release-moves-baseline`. No mutation run. Light verification: targeted typecheck and the law test file, one build at a time.
- **Ships:** the implementer opens the PR as ready after the supervisor rules on the open questions; the operator merges.

---

## Product Contract

### Summary

The law compares committed contract documents with the documents of the release main declares. Today it gets that release from the `stryker-published` flake pin. After this change it gets it from git, at the commit that set the version main declares. Both sides of the comparison then come from one source, so a release can no longer put them out of step.

### Problem Frame

Release #267 (`9e81669b8`) set `@systemfsoftware/stryker-js-cli-contract` to 0.5.0 and `@systemfsoftware/stryker-js-plugin-interface` to 16.0.0. Main's next `check` (run 38091732019 on `ec9dcf63c`) failed `contract-version-law.integration.test.ts` with `stale-baseline` (released 0.4.0, main 0.5.0). Main stayed red until #300 moved the pin by hand.

The cause is structural. The law reads main's version from git at `merge-base(origin/main, HEAD)` (`packages/stryker-js-cli-contract/tests/contract-version-law.integration.test.ts:126-140`). It reads the released version and documents from `node_modules/released-*`, which resolve to the pinned tarballs (`contract-version-law.integration.test.ts:169-182`, `packages/stryker-js-cli-contract/package.json:53-54`, `flake.nix:38`). When the two disagree and anything narrowed since the pinned release, the law refuses (`packages/stryker-js-cli-contract/tests/__fixtures__/contract-law.fixture.ts:244-245`). A release that changes a contract document always narrows something relative to the previous release, so every such release turns main red until a human moves the pin. The release commit itself is authored by `github-actions[bot]`, which CI skips (`.github/workflows/ci.yml:27`; run 38090511824 on `9e81669b8` was `skipped`). The first human push after the release is therefore the one that goes red.

### Requirements

**Baseline source**

- R1. For each contract package, the law's released version and released documents come from git, at the version commit: the newest commit on the first-parent history of `merge-base(origin/main, HEAD)` that introduces main's declared version, while its first parent declares a lower version or has no manifest.
- R2. The law reads no `.sfs-deps` tarball and no `released-*` alias. The two aliases leave `packages/stryker-js-cli-contract/package.json` and `pnpm-lock.yaml`.

**Strictness**

- R3. Every comparison the law makes today with a fresh pin gives the same verdict: the same required-version rule, the same failure kinds for narrowed members, unreadable documents and stream versions, and the same rendered lines.
- R4. When no version commit can be established for a package, the law refuses with a named failure and the fetch that restores the history. That covers three cases: no commit introduces main's version, the candidate's first parent is outside a shallow checkout, or the parent declares the same or a higher version (a rollback). It never guesses a baseline and never falls back to the pin.
- R5. The `stale-baseline` failure kind is removed, because the released and main versions are read from one commit and can no longer disagree (pending OQ1).

**Release flow**

- R6. On every main commit after a release, the law passes without a pin move unless something narrowed after the release without a covering declared version.
- R7. A version PR is still judged by the version it declares (`contract-version-law.integration.test.ts:824-944` keep their verdicts).

### Key Decisions

- **Read the baseline from the version commit, not from the pin and not from tags.** Of the three routes, it is the only one with no window in which main is red. Governs R1, R2, R6.
  - (i) The release workflow opens a pin-bump PR after tagging. Main stays red from the release until a human merges that PR. Bot-opened PRs start no workflows on their own (`.github/workflows/release.yml:4-5`), the flow lives in another repo (`release.yml:25`), and auto-merge is ruled out. The pin cannot ride in the version PR, because the commit it must point to is that PR's own merge (`9e81669b8`, squash-merged, carries every 0.5.0 tag).
  - (ii) The law reads the latest release tag. CI's `check` fetches main with `--no-tags` (`ci.yml:83-84`), so that job would also need a tag fetch. Tags land after the release run finishes, and for 0.4.0 they landed one commit late (`6cdb4e1d6` set the version, `8cbf31518` carries the tag), so a push in that window is still red.
  - (iii) This plan. CI already unshallows main's commit graph in `check` (`ci.yml:83-84`), so no workflow changes.
- **Dogfood pin freshness is not this law's job.** The pin keeps driving the Mutation CLI (`mutation.yml:37`). Moving it after a release stays the Dogfood process in root `AGENTS.md` and is no longer forced by a red `check` (OQ2).

### Acceptance Examples

- AE1. Covers R6. **Given** main at `9e81669b8` (cli-contract 0.5.0, its documents changed since 0.4.0), no pending intent and the pin still at `27b10759` (0.4.0). **When** the law runs on the next main commit. **Then** it passes. Today it fails `stale-baseline`.
- AE2. Covers R3. **Given** main declares 16.0.0 and its version commit holds 16.0.0's documents. **When** a PR drops a member with no changeset. **Then** the law refuses it at 17.0.0. The hole in the solution doc (`released-baseline-law-refuses-a-lagging-pin.md:28-34`) stays closed.
- AE3. Covers R7. **Given** a version PR whose merge base declares 0.5.0 and which commits 0.6.0 after a minor-level removal. **Then** it holds. Committing 0.5.1 instead is refused at 0.6.0.
- AE4. Covers R4. **Given** a checkout whose history does not reach the commit that set main's version, including a shallow checkout whose boundary commit declares it. **Then** the law refuses that package with a named failure and a fetch that restores the history.
- AE5. Covers R1, R4. **Given** a commit after the version commit that reformats the manifest's `version` line but keeps its value. **Then** the law refuses (the candidate's parent declares the same version) instead of adopting that commit as the baseline and missing a narrowing landed in between.
- AE6. Covers R4. **Given** release 0.5.0 is rolled back on main by reverting the manifest to 0.4.0. **Then** the law refuses, because the revert's parent declares a higher version. It does not adopt the revert as 0.4.0's baseline, which would wave through every narrowing landed after 0.4.0 shipped.

### Scope Boundaries

- No change to `.github/workflows/`, `flake.nix`, `flake.lock` or the release workflow. Mutation keeps installing the pinned tarballs (START-6 unchanged).
- No change to the law's comparison rules (`compareDocuments`, the required and declared version rules, the stream rule).
- The contract-shipping package set check stays (`contract-version-law.integration.test.ts:190-218`). It no longer needs a `released-*` alias per package.
- A contract package that main does not contain yet keeps today's behavior: reading main's version dies naming the missing manifest (`contract-version-law.integration.test.ts:132-140`). Nothing is released for it, so there is no baseline to choose.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Choosing the version commit is a pure decision over one candidate and its parent.** The git shell runs `git log --first-parent -1 --format=%H -S'"version": "<main version>"' <merge-base> -- <manifest>`. That is the newest first-parent commit that changes how often main's exact version line occurs. The shell then reads the candidate's first-parent state: missing (a shallow boundary, or no parent), no manifest, or a version. The literal is the line dprint writes (`"version": "0.5.0"`). `-S'"version":'` is wrong because its count never changes on a bump (1 hit on cli-contract against 6 for `-G` on a full clone). A `-G` walk is also wrong, because it must continue past the version commit to the previous release. In a shallow clone it also reports the boundary commit as adding the manifest: this repository's local clone, shallow at `cfde427d1`, listed `cfde427d1` as a version hit. A pure function takes the candidate, the parent state and main's version. It accepts when the parent has no manifest or declares a lower version. It refuses, per R4, when there is no candidate, the parent is missing, or the parent declares the same or a higher version (AE4, AE5, AE6). Measured cold in CI's checkout shape (`--depth=1` clone, then `ci.yml:83-84`'s `fetch --filter=tree:0 --unshallow`): 1.6 s and 0.3 s for the two packages when the version commit is one commit back, and 14.4 s when it is about 100 commits back. A `-G` walk to the previous release took 82.7 s in the same shape. Cost grows with the distance from HEAD to the version commit, because `tree:0` fetches each tree lazily. Prior art: cargo-semver-checks takes its baseline from a git revision (`--baseline-rev`).
- KTD2. **Released documents are the `contract/*.json` files at the version commit.** The tarballs are `pnpm pack` of the pinned commit's own tree (`flake.nix:58-64`, `src = self`), and neither package has a pack-time script that writes `contract/` (`generate:contract` is manual). So the shipped documents are the tree's documents by construction. All four documents in the 0.5.0 and 16.0.0 tarballs hash the same as `git show 9e81669b8:<path>`. For every release of the two packages, the version commit is the tagged commit (0.5.0 and 16.0.0) or has identical documents and manifest (0.4.0 and 15.0.0: `6cdb4e1d6` against tag `8cbf31518`).
- KTD3. **`PackageContracts` drops `releasedVersion`.** Required and declared versions derive from `mainVersion` and the version commit's documents. The `stale-baseline` branch at `contract-law.fixture.ts:244-245` goes, along with `staleBaselineFailureOf` (`:165-173`). A new `released-baseline-unavailable` kind covers R4, shaped like `main-baseline-unavailable` (`:175-183`). This depends on OQ1.
- KTD4. **The shell reuses the existing git runner and adds no git-spawning tests.** `runGit` and `gitOutput` (`contract-version-law.integration.test.ts:101-124`) already spawn git without a shell. The existing live scenario (`:401-428`) runs `readWorkspace` on the real repository, so a shell that finds no version commit fails it with the R4 refusal. New coverage goes to the pure decision and the pure law, because the test-layer gate refuses process spawns in integration tests.

### Assumptions

- The release engine tags the version commit, or a later commit with identical contract documents. This holds for all four releases of the two packages. The current law already relies on it when it reads main's version as the last one shipped (`released-baseline-law-refuses-a-lagging-pin.md:38`).
- `check` keeps running the law with main's full commit graph (`ci.yml:83-84`). A shallow checkout gets the R4 refusal through KTD1's missing-parent case, not a wrong verdict.

### Sequencing

U1 then U2 then U3, one commit each, in one PR.

---

## Implementation Units

### U1. Law reads its baseline from the version commit

- **Goal:** R1, R3, R4, R6, R7 through KTD1, KTD3 and KTD4, plus R5 once OQ1 is ruled.
- **Files:** `packages/stryker-js-cli-contract/tests/contract-version-law.integration.test.ts`, `packages/stryker-js-cli-contract/tests/__fixtures__/contract-law.fixture.ts`.
- **Approach:** add the pure decision from KTD1 to the fixture beside `evaluateContractLaw`. `readWorkspace` (`:166-188`) runs the KTD1 shell for each package, applies the decision, and reads the manifest version and `contract/*.json` at the chosen commit in place of `releasedRoot`. Remove `CLI_CONTRACT_RELEASE`, `PLUGIN_INTERFACE_RELEASE` and `releasedAlias` (`:40`, `:43`, `:61-70`). In the fixture, remove `releasedVersion` and add the R4 failure kind with its render lines. Remove `staleBaselineFailureOf` and the branch at `:244-245` only as R5 rules, after OQ1.
- **Test scenarios:**
  - Property over generated candidates, parent states and main versions. The decision accepts exactly when a candidate exists and its parent has no manifest or declares a lower version. A missing parent (AE4), the same version (AE5) or a higher version (AE6) always yields the refusal.
  - AE2, pure law input: main at 16.0.0, a dropped member, no intent. Refused at 17.0.0. This replaces "refuses a narrowing no changeset declares" (`:748-771`).
  - AE4 rendering, pure: the new failure renders its code, package, main version and the fetch, in the format of `:736-745`.
  - Delete "refuses to compare while a changeset is pending" (`:722-746`) under R5. With released and main read from one commit, the state it fed the law no longer exists.
  - The test-layer gate refuses new live-git scenarios for AE1 and AE4-AE6. The AE1 smoke in the Verification Contract shows AE1 instead.
  - The version-PR outlines (`:824-944`) keep their rows and expectations. The live scenario (`:401-428`) still asserts the weighed packages equal the contract-shipping packages.
- **Verification:** the law test file passes. The three probes in the Verification Contract fail against their broken variants.

### U2. Remove the released aliases

- **Goal:** R2.
- **Files:** `packages/stryker-js-cli-contract/package.json`, `pnpm-lock.yaml`, `.changeset/<name>.md`.
- **Approach:** delete the two `released-*` devDependencies (`package.json:53-54`) and relock offline. The packed manifest of cli-contract changes, so add a changeset at `none` with one line saying nothing a consumer imports or runs changes.
- **Test expectation:** none, because this is a dependency removal. `pnpm install --frozen-lockfile` and the START-6 grep cover it.
- **Verification:** `git grep -n 'released-stryker-js' -- . ':!**/CHANGELOG.md' ':!docs/plans/**'` returns nothing (DEL1).

### U3. Resolve the solution doc in place

- **Goal:** the recorded guidance matches the law.
- **Files:** `docs/solutions/tooling-decisions/released-baseline-law-refuses-a-lagging-pin.md`.
- **Approach:** rewrite the title, Guidance, Why This Works and Prevention around the version commit. Keep the lagging-pin example as the reason one source beats two. Prevention names the selection property and the AE2 scenario as gates.
- **Test expectation:** none, because this is documentation.

---

## Verification Contract

| Check               | Command (from the package unless noted)                                                                                                                                                                      | Proves                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Typecheck           | `pnpm exec tsc -b --force`                                                                                                                                                                                   | U1 compiles                                                        |
| Law                 | `CI=true pnpm exec vitest run tests/contract-version-law.integration.test.ts`                                                                                                                                | the decision property, AE2, AE4 rendering, R3, R7                  |
| AE1 smoke           | After `git fetch --unshallow origin` (the local clone is shallow at `cfde427d1`), apply U1 in a scratch worktree at `ec9dcf63c` (after the 0.5.0 release, pin still at 0.4.0) and run the law file           | passes where run 38091732019 failed `stale-baseline`               |
| Probe: rollback     | Temporarily accept any parent that declares a different version. The property must fail on AE6.                                                                                                              | the parent must declare a lower version                            |
| Probe: no refusal   | Temporarily accept a missing parent. The property must fail on AE4.                                                                                                                                          | R4 holds in a shallow checkout                                     |
| Probe: wrong filter | In the AE1 smoke, temporarily use `-S'"version":'`. The live scenario `:401-428` must fail with the R4 refusal.                                                                                              | the shell's filter is load-bearing                                 |
| Lookup cost         | `git clone --depth=1 --no-tags --single-branch` of main, then `git fetch --no-tags --filter=tree:0 --unshallow origin +refs/heads/main:refs/remotes/origin/main`, then time the KTD1 shell for both packages | under 60 s; record the figure in the PR body as added `check` time |
| Hermetic install    | repo root: `nix build .#stryker-published --out-link .sfs-deps && pnpm install --frozen-lockfile && ! git grep -qE "^  '@systemfsoftware/stryker-[a-z-]+@[0-9]" -- pnpm-lock.yaml`                           | START-6                                                            |
| Format, changeset   | repo root: `./bin/dprint check`; the author-changesets validator on the new changeset                                                                                                                        | START-1, START-5                                                   |
| CI                  | `run_watch` on the PR head                                                                                                                                                                                   | `check` green                                                      |

---

## Definition of Done

- R1-R7 hold, the decision property and the AE2 and AE4 scenarios pass, and the AE1 smoke passes.
- The three probes fail against their broken variants and are reverted.
- The DEL1 grep in U2 returns nothing. Under R5, no `stale-baseline` reference remains outside CHANGELOGs and dated plans.
- The solution doc no longer tells a reader to move the `stryker-published` pin to fix a stale baseline (U3).
- CI `check` is green on the PR head. Known Bench red (#274) is named, not chased.
- No probe or scratch code stays in the diff.

---

## Open Questions

- OQ1. Removing `stale-baseline` (R5, KTD3) follows DEL1, because no input can reach it any more. The brief says "no weakening of stale-baseline". The other choice keeps the pin-based kind as dead code under its own scenarios. This plan removes it and adds `released-baseline-unavailable`, which refuses whenever the baseline cannot be established. Needs a ruling.
- OQ2. Nothing will force the dogfood pin forward after a release any more, because the red `check` that forced it goes away. Accept that the Dogfood row in root `AGENTS.md` stays a process step, or ask for a separate mechanism. A new gate needs approval under GATE1.
- OQ3. If tagging fails after a version merge (0.4.0: the tag landed one commit late), the law treats the version commit as released before any tag exists. The current law already makes this assumption. Accept it?

## Size

3 units in one PR. About 6 files: the law test, the fixture, the cli-contract `package.json`, `pnpm-lock.yaml`, the solution doc and one changeset. Estimated +150/-110 lines of TypeScript and tests, -10 lockfile lines, and a rewrite of about 40 doc lines. Added `check` time: under 2 s today, rising toward the 60 s stop as main moves away from the last release.
