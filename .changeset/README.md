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
  lands: consumption is recorded in `ledger.yaml` and the intent files
  are retained, so a present intent alone never implies a pending release.
- This README is NOT a changeset: the gate requires a file whose frontmatter
  parses as `"<pkg>": <none|patch|minor|major>`.

Publishing uses npm OIDC trusted publishing from `.github/workflows/release.yml`.
For a package npm has never seen, register it (and this repository plus that
workflow filename) as a trusted publisher on npmjs.com before its first version
ships — OIDC cannot debut a package npm has never seen. The `@systemfsoftware/stryker-js*`
family is already published; only a new package name needs this step.
