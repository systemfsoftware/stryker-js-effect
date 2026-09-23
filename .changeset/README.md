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

## Two-stage intent deletion

pnpm unlinks consumed intents only after the npm registry confirms the
versions those intents produced. The cycle is:

1. **Version PR.** `pnpm version -r` consumes pending intents, writes
   `.changeset/changelogs/<pkg>@<ver>.md`, and records stems in
   `ledger.yaml`. The new versions are not on npm yet, so
   `confirmPublished()` fails and the intent `.md` files stay on disk.
2. **Publish.** The version PR merges; CI publishes and pushes git tags.
3. **Next version PR.** The next `pnpm version -r` scans
   `.changeset/changelogs/`, `verifyPublished()` / `confirmPublished()`
   against npm, deletes confirmed changelog files, and unlinks the
   intent `.md` files whose releases are all confirmed.

If `.changeset/changelogs/` is deleted out of band before that
confirmation, the matching intent files become permanent orphans: pnpm
has nothing left to verify, so it never unlinks them. Remove those
stems by hand only after the ledger already records them and npm
already serves the versions.

## Interruption safety

The Release workflow concurrency group is `release-${{ github.ref }}`
with `cancel-in-progress: false`. Pushes to `main` queue; they never
cancel an in-flight release run.

Every non-idle release run first passes a **gate** job that runs the same
`pnpm check:ci` as CI. `version` and `publish` both depend on it, so a red
suite blocks the release PR and the npm publish alike — a release can never
outrun the tests that guard it.

- An interrupted **version** job is safe: it only commits on the
  isolated `changeset-release/main` branch and opens or updates a PR;
  `main` is untouched.
- An interrupted **publish** job is safe: `unpublishedOf()` treats a
  registry 404 as still owed, so a killed publish remains in `owed` on
  the next run.

Publishing uses npm OIDC trusted publishing from `.github/workflows/release.yml`.
For a package npm has never seen, register it (and this repository plus that
workflow filename) as a trusted publisher on npmjs.com before its first version
ships — OIDC cannot debut a package npm has never seen. The `@systemfsoftware/stryker-js*`
family is already published; only a new package name needs this step.

If the GitHub repository changes (e.g. transfer, rename, or fork) or new packages are introduced:

1. Run `pnpm publish:unpublished --dry-run` to preview the bootstrap and trust setup.
2. Run `pnpm publish:unpublished --fix` from a maintainer machine with npm auth to update `package.json` repository URLs to the new repository slug, debut any unpublished packages, and configure `npm trust github` for all workspace packages.
3. Run `./scripts/check-npm-publish.ts` to inspect the published/attested state of all packages across the registry.
