# Changesets

This directory holds change-intent files consumed by pnpm-native workspace
versioning (`pnpm version -r`). One file per change, authored with:

```
pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" [<pkg>...]
```

- A PR that changes anything under an application or package path MUST ship with
  an intent here. Root tooling is outside the verdict.
- `--bump none` records a change that needs no release. A `none` on a
  behavior-visible change is the same silent non-release the gate exists to
  catch.
- Intents are consumed by `pnpm version -r` when the Release PR
  lands: consumption is recorded in `ledger.yaml`. A present intent
  file alone never implies a pending release — count only stems absent
  from the ledger (`countPendingIntents`).
- This README is NOT a changeset: the gate requires a file whose frontmatter
  parses as `"<pkg>": <none|patch|minor|major>`.

## Changelogs

`pnpm-workspace.yaml` sets `versioning.changelog.storage: repository`, so
`pnpm version -r` writes each release's `## <version>` section into the
package's committed `CHANGELOG.md`, and that file ships in the package's
tarball. Nothing is parked under `.changeset/changelogs/`.

1. **Version PR.** `pnpm version -r` consumes pending intents, writes the
   `## <version>` sections, and records the consumed stems in `ledger.yaml`.
2. **Release.** The version PR merges; CI pushes the git tags and creates each
   GitHub Release from that version's `CHANGELOG.md` section.

pnpm-release-management's release engine holds this: it reads
`versioning.changelog.storage` with `pnpm config get` and refuses any value
but `repository` or `registry`, `pnpm version -r` writes exactly one section
per release, and only `registry` storage parks a file.

## Interruption safety

The Release workflow concurrency group is `release-${{ github.ref }}`
with `cancel-in-progress: false`. Pushes to `main` queue; they never
cancel an in-flight release run.

Every non-idle release run first passes a **gate** job that runs the same
`pnpm check:ci` as CI. `version` and `release` both depend on it, so a red
suite blocks the release PR and the tags alike — a release can never
outrun the tests that guard it.

- An interrupted **version** job is safe: it only commits on the
  isolated `changeset-release/main` branch and opens or updates a PR;
  `main` is untouched.
- An interrupted **release** job is safe: a tag exists only once it is pushed,
  and a version without its tag stays owed on the next run.

## New packages

Nothing is published to an npm registry: `release.jsonc` states that packages
are versioned independently, tagged `<pkg>@vX.Y.Z` and distributed as the
repository's Nix flake outputs from a git ref, and the Release workflow has no
publish step. A new package needs no registration or bootstrap.

A member that is not `private` is owed a `<pkg>@v<version>` tag at the version
its manifest declares, ahead of any pending intent, and its GitHub Release reads
a `CHANGELOG.md` section for that version, which only `pnpm version -r` writes.
A new package therefore has to land at a version that is already tagged, or the
next release run tags that version and fails on the missing changelog. Before
merging, build `.#workspace-tarballs` and run the release tools' `plan` (it must
report `phase=version`), `tag --dry-run` and `release --dry-run` against it.
