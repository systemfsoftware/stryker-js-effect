---
title: A version law reads its released baseline from the commit that set main's version, never from a pin
date: 2026-10-11
category: tooling-decisions
module: contract-version-law
problem_type: tooling_decision
component: testing
severity: high
applies_when:
  - "Changing the contract version law or how it finds its released baseline"
  - "Writing any check that compares committed artifacts against a released copy"
  - "Changing how CI's check job fetches main's history"
  - "Adding a package that ships a contract directory"
---

# A version law reads its released baseline from the commit that set main's version, never from a pin

## Context

The contract version law compares each committed contract document of `@systemfsoftware/stryker-js-cli-contract` and `@systemfsoftware/stryker-js-plugin-interface` with the same document as released. A narrower document needs a declared next version at or above the required one:

$$\text{required} = \text{bump}(\text{main},\ \text{level}) \qquad \text{declared} = \text{bump}(\text{committed},\ \max(\text{pending intents}))$$

where `main` is the version the package manifest declares at `merge-base(origin/main, HEAD)`, and `level` is major, or minor while that major is 0. The law holds when $\text{declared} \ge \text{required}$.

## Problem

The law used to read the released documents from the `stryker-published` flake pin, installed as `released-*` aliases. It then had two sources for one fact: main's version moved when the version PR merged, and the pin moved only when someone moved it. Each choice of what to do between those two events failed:

- **Judging anyway lets a narrowing through.** Pin at 15.0.0, main at 16.0.0, no pending intent. A PR deletes a member: required 16.0.0, declared 16.0.0, so the law holds, and the next 16.x release breaks 16.0.0 consumers.
- **Refusing turns main red after every release.** The law refused to judge while the pin lagged. Release #267 set cli-contract to 0.5.0, so main's next `check` (run 38091732019) failed until #300 moved the pin by hand.

## Guidance

Read both sides of the comparison from git. The released baseline is the **version commit**: the newest commit on the first-parent history of the merge base that changes the manifest line `"version": "<main's version>"`, accepted only when its own manifest declares main's version and its first parent holds no manifest or declares a lower version.

```text
candidate = git log --first-parent -1 -S'"version": "<main>"' <merge-base> -- <manifest>
no candidate, or its manifest
  declares another version       -> refuse  NoVersionCommit   (no-version-commit)
parent outside the history       -> refuse  HistoryTruncated  (history-truncated)  next: git fetch --unshallow origin main
parent declares no manifest      -> baseline = candidate
parent declares a lower version  -> baseline = candidate
parent declares main's version   -> refuse  VersionUnchanged  (version-unchanged)
parent declares a higher one     -> refuse  VersionRollback   (version-rollback)
```

Each refusal is its own `Schema.TaggedError` variant (CONST-D2), and callers branch on `_tag`. Each renders its stable `code`, the package, the version sought, a reason and the next action. The released documents are `git show <version commit>:<package>/contract/*.json`.

- **Main stays green after a release.** On the release commit the baseline is that commit, so the documents compare equal. No pin has to move first.
- **The lagging-pin hole stays closed.** A narrowing that lands after the version commit, under the same version, is judged against that commit's documents and refused at the next version.
- **A version PR is judged, not refused.** Its merge base still declares the released version, so the baseline is the last release. The bump is the declared version and must clear what narrowed: 0.4.0 → 0.5.0 clears a minor-level removal, 0.4.0 → 0.4.1 is refused at 0.5.0.
- **The search string is exact, and the candidate is checked.** `-S'"version":'` counts occurrences of the key, which a bump never changes, so it finds only the commit that added the manifest. In full history that is `6f8a052b0` (cli-contract at 0.1.0) and `54e127298` (plugin-interface at 4.0.0); their parents hold no manifest, so without the check that a candidate's own manifest declares main's version, either would have been adopted as the baseline. `-G` walks every bump back to the previous release. Measured 2026-10-11 on main `ec9dcf63c`, cold clone in the shape CI `check` fetches (`--depth=1`, then `git fetch --no-tags --filter=tree:0 --unshallow`): the `-G` walk took 82.7 s; the exact `-S` lookup plus reading the contract documents took 1.4 s for both packages, whose version commit `9e81669b8` is one commit back. With the version commit about 100 commits back (`6cdb4e1d6`, 0.4.0) the `-S` lookup took 14.4 s, because `tree:0` fetches each tree lazily.
- **A shallow checkout refuses, never passes.** Its boundary commit looks like it adds every file, so a version commit whose parent lies outside the clone is `HistoryTruncated`. CI `check` unshallows main before the tests run, so CI never reaches this refusal; a local shallow clone does.
- **A treeless clone gets its trees in one fetch, before the walk.** CI `check` fetches main with `--filter=tree:0`: commits, no trees. A path-limited `git log` in that clone fetches each missing tree on demand, one round trip per commit walked. The case's cost then grows with every merge to main until the next release.
  - The live case went from about 12.7 s at 32 first-parent commits since `9e81669b8` to a 30 s timeout at 40 (main `02bd69908`, run 38445827562) and at 41 (#319, run 38451521025). On every base measured, the walk made exactly the commits walked plus 3 lazy fetches.
  - The reader now lists the root trees of the first-parent history (`git log --first-parent --format=%T`, commits only). If the oldest is missing, it fetches them all in one `git fetch --filter=blob:none origin <trees>`. "Missing" means `git --no-lazy-fetch cat-file -e` exits 1 with nothing on stderr; it never fetches, and any other failure stops the case.
  - Effect, on a fresh treeless clone of main `b08379ddd` (PR #349): the live case passes in 1.8 s with one prefetch plus 4 lazy blob fetches for the manifests it compares. The old reader made 45 fetches and timed out.
  - A full or shallow clone already holds the trees, so it fetches nothing. The presence check is what keeps a full clone full: a filtered fetch in a full clone registers `origin` as a promisor remote (`remote.origin.promisor true`, `core.repositoryformatversion 1`) even when it transfers nothing.
  - What the law decides is unchanged.
- **The weighed package set is checked, not trusted.** The packages the law reads must equal the workspace packages whose manifest `files` declares `contract`, found by expanding the `pnpm-workspace.yaml` `<dir>/*` globs.
- **The law's verdict is never cached.** It reads git state, which no turbo input can carry. The cli-contract `turbo.json` turns the `test` cache off, and declares the root `.changeset/` directory, the workspace manifests and the contract documents as `test` inputs, so a change to them selects the law under `--affected`. Gate: `turbo run test --dry=json` resolves `cache: false` for `@systemfsoftware/stryker-js-cli-contract#test`.
- **The dogfood pin is a separate process.** `stryker-published` still drives the Mutation CLI. Nothing forces it forward after a release any more, and a lagging pin no longer turns main red. Moving it stays the Dogfood step in root `AGENTS.md`.

## Assumptions

- **The version commit is released.** The law treats the commit that set main's version as the release of that version before any tag exists. The release engine tags every version that lands on main, but a tag can land a commit late: for 0.4.0 the version commit is `6cdb4e1d6` and the tag sits on `8cbf31518`, with identical contract documents.
- **The released documents are the committed ones.** The tarballs are `pnpm pack` of the release commit's own tree (`flake.nix`, `src = self`), and no pack-time script writes `contract/`. All four documents of the 0.5.0 and 16.0.0 tarballs hash the same as `git show 9e81669b8:<path>`.

## Why This Works

A comparison is only sound when both sides come from one source. Reading main's version and the released documents from the same commit leaves no window in which they disagree, so the law needs no rule for staleness and no human step to clear it. Any check that compares against a pinned released copy has the same hole: either derive the copy from the source the version comes from, or decide the window explicitly.

## Prevention

- Gate: the scenario "A narrowing that lands after the version commit, under the version it set, is refused at the next version" in the cli-contract `contract-version-law.integration.test.ts`, run by `pnpm test` in CI `check`. Clearing narrowings by main's version again turns it red.
- Gate: the outlines "A released baseline that cannot be established is refused as its own variant with the action that restores it" and "The commit that moved the manifest up to main's version is the released baseline", and the scenario "The commit that added the manifest is never the baseline when it declares a version other than main's". Accepting a rollback, a truncated history or a candidate declaring another version turns a row red.
- Gate: the live outline "A shallow checkout that cannot see the parent of the version commit refuses as truncated history" (depth 1 and 2 clones of a temporary repository) and the live scenario "A version commit that is the root of a full history is the released baseline".
- Gate: the live outline "Finding the version commit costs the same round trips however long main ran since the release" counts the round trips a clone makes to a local origin through an `upload-pack` wrapper. The origin released 1.2.0 over 1.1.0, then moved on with one manifest edit that keeps the version.
  - A treeless clone costs 3 round trips (one tree prefetch, two manifest blobs) at both 6 and 24 commits. The old reader's count grows by one with every commit walked, so both treeless rows are red on it.
  - A full clone costs 0 and must still have no promisor remote afterwards, which a reader that always fetched would fail.
- Gate: the live scenario "The committed contract documents keep every ground the released ones hold" runs the git lookup on the real repository and asserts the weighed packages equal the contract-shipping packages. A search that finds no version commit turns it red with the refusal; searching for the bare key turns it red with `no-version-commit` for both packages.
- Gate: the outlines "A version PR is judged by the version it declares over the release main still carries" and "A version PR whose bump does not clear a narrowing is refused at the version the release requires".
- Smell: a check whose "required" side and "declared" side read their versions from different sources with no rule for when those sources disagree.
