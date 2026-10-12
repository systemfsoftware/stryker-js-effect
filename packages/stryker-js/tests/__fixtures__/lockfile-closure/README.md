# Lockfile-closure fixtures

Inputs for `tests/lockfile-closure-digest.integration.test.ts`. Every lockfile here is tool output, never a hand edit, and dprint does not format this directory.

## `real/`

The repository's root `pnpm-lock.yaml` at two commits, taken verbatim with `git show <sha>:pnpm-lock.yaml`:

| File                          | Commit      | What it is                                                                        |
| ----------------------------- | ----------- | --------------------------------------------------------------------------------- |
| `pnpm-lock.56426ca94.yaml`    | `56426ca94` | The lock before #266                                                              |
| `pnpm-lock.ec9dcf63c.yaml`    | `ec9dcf63c` | The lock after #266, which added an importer (`test/checker-parity`) that no mutated project links |

## `oracle/`

A small pnpm workspace whose locks pin every key form the closure walk resolves: a plain version, a peer suffix (`use-sync-external-store`), `patch_hash` (`kleur`), a `file:` tarball (`local-tgz`), a scoped npm alias, an unscoped npm alias, a JSR alias, and a `link:` to an importer that has only `devDependencies`.

- `workspace/` is the template: a root with one devDependency, and importers `a`, `b` and `c`. Only `a` reaches `ms`; `b` links `c`.
- `variants/<name>/` holds the files that replace the template's for one variant: `x-bumped` moves `ms` in `a`, `root-dev-bumped` moves the root devDependency, `tgz-repacked` changes the vendored tarball's bytes under the same key.
- `locks/<name>.pnpm-lock.yaml` is the lock pnpm wrote for each variant; `base` is the template itself.

Regenerate every lock with the repository's pinned pnpm:

```sh
pnpm --filter @systemfsoftware/stryker-js fixtures:lockfile-oracle
```

The script refuses to run under any pnpm other than the root `packageManager`, packs the vendored tarball with `npm pack` (reproducible bytes), runs `pnpm install --lockfile-only` twice per variant, and writes a lock only when both runs are byte-identical. It needs registry access to npmjs.org and npm.jsr.io. The template's `packageManager` records the pnpm that wrote the locks.
