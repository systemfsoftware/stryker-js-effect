---
title: "pnpm registry changelogs must be committed or synthesized from ledger for GitHub Releases"
date: 2026-09-18
category: tooling-decisions
module: release-pipeline
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - "Configuring pnpm native monorepo versioning with GitHub Releases"
  - "Asserting or creating GitHub Releases from .changeset/changelogs/"
  - "Debugging 'Missing changelog' in CI publish or release jobs"
tags: [pnpm, changeset, changelog, ledger, release-notes, github-release]
---

# pnpm registry changelogs must be committed or synthesized from ledger for GitHub Releases

## Context

In pnpm native workspace versioning (pnpm 11+), `versioning.changelog.storage` defaults to `registry`. Under this mode, `pnpm version -r` writes temporary changelog sections into `.changeset/changelogs/<pkg-name-with-slash-as-bang>@<version>.md` and records consumed intent stems into `.changeset/ledger.yaml`.

Post-publish release tooling (such as `create-github-releases.ts`) expects these markdown files to exist in `.changeset/changelogs/` to populate GitHub Release bodies.

When `.changeset/changelogs/` was added to `.gitignore`, git ignored the directory on the `changeset-release/main` PR branch. When the PR merged to `main`, the `publish` job checked out `main` without `.changeset/changelogs/`. Attempting to run `pnpm version -r` on `main` failed to regenerate them because all change intents were already consumed in `ledger.yaml` (exiting with `"No pending changes"`). CI assertion failed with `Missing changelog for <pkg>@<version>`.

## Guidance

1. **Commit changelogs or remove ignore**: Never add `.changeset/changelogs/` to `.gitignore`. They must be tracked and committed by the `version` job into the Release PR.
2. **Defensive fallback synthesis from ledger**: `ensureChangelog` should fall back to reading `.changeset/ledger.yaml` and the corresponding `.changeset/<intent>.md` files to reconstruct the changelog section dynamically if `.changeset/changelogs/` is missing on disk in CI.
3. **Do not run `pnpm version -r` in publish job**: On `main`, pending change intents are already consumed by the version-packages commit. Running `pnpm version -r` in the publish job is a no-op that cannot generate notes.

## Architectural Invariants

- **The release notes source must survive across jobs**: The `publish` job cannot re-run `pnpm version -r` once the ledger is committed. Release notes must either arrive via git or be reconstructible from `ledger.yaml` and `.changeset/*.md`.
- **Intents are retained on disk**: pnpm retains `.changeset/*.md` even after ledger recording, making deterministic synthesis from ledger + intent files possible at any point after the merge.
