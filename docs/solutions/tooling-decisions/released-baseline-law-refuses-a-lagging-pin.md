---
title: A version law against released tarballs must refuse to judge while the pin lags the workspace version
date: 2026-10-09
category: tooling-decisions
module: contract-version-law
problem_type: tooling_decision
component: testing
severity: high
applies_when:
  - "Changing the contract version law or its stale-baseline rule"
  - "Writing any check that compares committed artifacts against a pinned released copy"
  - "Moving, or forgetting to move, the stryker-published flake input after a release"
  - "Adding a package that ships a contract directory"
---

# A version law against released tarballs must refuse to judge while the pin lags the workspace version

## Context

The contract version law compares each committed contract document of `@systemfsoftware/stryker-js-cli-contract` and `@systemfsoftware/stryker-js-plugin-interface` with the same document in the released tarball the workspace dogfoods. The tarballs come from the `stryker-published` flake input and are installed as `released-*` dependency aliases. A narrower document needs a declared next version at or above the required one:

$$\text{required} = \text{bump}(\text{released},\ \text{level}) \qquad \text{declared} = \text{bump}(\text{committed},\ \max(\text{pending intents}))$$

where `level` is major, or minor while the released major is 0. The law holds when $\text{declared} \ge \text{required}$.

## Problem

The two baselines differ. `released` comes from the pin, which moves only when someone moves it after a release. `committed` moves as soon as the version PR merges. Between those two events the workspace version has already been raised, and the raise clears every narrowing, even with no changeset:

- released 15.0.0 (pin), committed 16.0.0 (version PR merged), no pending intent
- a PR deletes a member: required = 16.0.0, declared = 16.0.0, so the law holds
- the next release ships 16.0.1 or 16.1.0, which breaks consumers of 16.0.0 under a non-major bump

A first fix refused only when an intent was pending. That missed the case above, because a narrowing with no changeset at all is exactly the one the law exists to catch.

## Guidance

The pin is fresh when it matches the version main declares, read from the package manifest at `merge-base(origin/main, HEAD)`. The release engine tags every version that lands on main, so main's version is the last one shipped. The version the change commits is not the one to check against the pin:

```text
if released == main:
    report incompatibilities not cleared by declared >= required
else if pending intents exist or any document narrowed (judged with no clearing):
    fail: stale baseline — move the stryker-published flake input to the latest release tag
else:
    hold
```

- **A version PR is judged, not refused.** On `changeset-release/main` the changesets are consumed and the manifest moves to the next version. Main still declares the released version, so the pin is fresh. The bump is the declared version and must clear what narrowed: 0.4.0 → 0.5.0 clears a minor-level removal, while 0.4.0 → 0.4.1 is refused at 0.5.0.
- **The lagging-pin hole stays closed.** Once the version PR merges, main declares the new version while the pin still holds the old one. Any narrowing or pending intent from then on is refused as a stale baseline until the pin moves.
- **Main stays green after a release that did not touch the contracts.** No narrowing and no pending intent means there is nothing to judge, so a lagging pin alone never fails the build.
- **The failure names its fix.** The stale-baseline message tells the author to move the flake input. That move is already the declared dogfood process: a release moves `stryker-published` to its tag.
- **The weighed package set is checked, not trusted.** The packages the law reads must equal the workspace packages whose manifest `files` declares `contract`, found by expanding the `pnpm-workspace.yaml` `<dir>/*` globs. A new contract package fails the live scenario until it gets a `released-*` alias.
- **Main's version comes from git, not from tags.** CI `check` fetches main's commit graph without tags (`git fetch --no-tags --filter=tree:0`), so whether a tag exists cannot be read there. The live scenario dies with a fetch hint when `origin/main` is missing; it never guesses.

## Why This Works

The comparison is only sound when the released documents are the last release main declares. A change may only move the version forward with its own declaration. Comparing the pin with the committed version mistook a version PR's own declaration for a lagging pin, which turned every release PR red. Comparing it with main's version separates the two: on a version PR, main is at the pin and the committed version is the next one; after the merge, main has moved past the pin. Any check that compares against a pinned released copy has the same hole. Find the window where the pin and the source version disagree and decide it explicitly.

## Prevention

- Gate: the scenario "A released baseline behind the version main declares refuses a narrowing no changeset declares" in the cli-contract `contract-version-law.integration.test.ts`, run by `pnpm test` in CI `check`. It feeds the law main at 16.0.0, released 15.0.0, no intent and a dropped member, and expects the stale-baseline failure. Restoring the old clearing turns it red.
- Gate: the outlines "A version PR is judged by the version it declares over the release main still carries" and "A version PR whose bump does not clear a narrowing is refused at the version the release requires". Comparing the pin with the committed version instead of main's turns four of their rows red.
- Gate: the live scenario "The committed contract documents keep every ground the released ones hold" asserts that the weighed packages equal the contract-shipping packages. Adding `contract` to a third package's `files` turns it red.
- When probing workspace globs, stat each entry for `Directory` before probing `package.json`. `FileSystem.exists` fails with ENOTDIR on files that sit beside packages, such as an `AGENTS.md`.
- Smell: a check whose "required" side and "declared" side read their versions from different sources with no rule for when those sources disagree.
