---
title: A second tsdown config rewrote package.json#exports from its own entries, deleting the source condition a suite needs to import its own package
date: 2026-09-18
category: build-errors
module: stryker-js
problem_type: build_error
component: tooling
severity: high
symptoms:
  - "After a full build, every test in a package's tests/ tree fails with TS2307 Cannot find module '@systemfsoftware/<its-own-name>'"
  - "package.json#exports is { \"./package.json\": \"./package.json\" } although the package builds five entry points and its sourceExport config declares them all"
  - "publishConfig.exports is complete while the top-level exports map is not, so the package resolves for consumers and not for itself"
  - "pnpm install reports 'Already up to date' while a workspace package's node_modules is missing a symlink for a dependency its manifest declares"
root_cause: config_error
resolution_type: config_change
tags: [tsdown, exports, self-reference, build-order, workspace-imports, pnpm-links]
---

# A second tsdown config rewrote `package.json#exports`

## Problem

`@systemfsoftware/stryker-js` builds two ways from one package: a library
config (`tsdown.config.ts`, five entries, `exports: sourceExports({ dtsExt })`)
and a binary config (a second config file, one `main` entry, with its own
`exports` option). After `pnpm build`, the package could no longer import
itself: every file under `packages/stryker-js/tests/` failed with
`TS2307: Cannot find module '@systemfsoftware/stryker-js'`, and the same imports
resolved to `any` under the type-aware lint rules.

The tests cannot dodge this. The repo's `effect-dmmf/tests-import-public-api`
rule forbids `../src/*` from a package's `tests/` tree, so a suite that lives
there must import its own package by name — which is exactly the resolution the
build had broken.

## Root cause

tsdown rewrites `package.json#exports` from **its own** entry map on every run.
The binary config's map is a single `main` entry, and its `exports.exclude:
['main']` removes it, so the map tsdown generated for that config contained
nothing but `"./package.json"`. Because `build` ran the library config first and
the binary config second, the binary config's write was the last one, and the
library config's map — including the `@systemfsoftware/source` condition every
in-workspace import depends on — was gone.

tsdown treats `exports` per package, and it errors with _"Conflicting exports
options for package … Please merge them"_ only when two configs reach it in one
process. Two `tsdown --config` invocations are two processes, so nothing warns;
the later one simply wins.

## Solution

Build both from one tsdown run. `tsdown.config.ts` exports an array: the library
entry declares `exports: sourceExports({ dtsExt })`, the binary entry declares no
`exports`, and neither disables `clean`.

```json
"build": "pnpm run typecheck && tsdown"
```

In one process tsdown cleans `dist/` once, for every config, before any bundle
starts. It then writes `package.json` once per package, after that package's last
bundle, from the configs that declare `exports`. No ordering can go wrong, and
no window opens with a half-written manifest.

The first fix kept two processes and ordered them (`rimraf dist`, then the binary
config, then the library config, both with `clean: false`). That still opened a
window: the binary pass rewrote `exports` down to `./package.json` before the
library pass restored it. A turbo task that read the manifest during that window
failed with `"./config" is not exported`.

Verify it holds after a build, not by reading the config:

```bash
pnpm --filter @systemfsoftware/stryker-js build
jq -r '.exports | keys[]' packages/stryker-js/package.json
```

A correct map lists every subpath. `{"./package.json"}` means a second process
wrote the manifest again.

## Architectural invariants

**1. One process writes each generated manifest.** `exports` is a build output,
not a source file. A package with more than one build configuration builds all
of them in one tsdown run. There tsdown merges them, refuses two configs that both
declare `exports`, and writes the manifest once. Across processes nothing is
merged: the last write wins.

$$ \text{final}(\texttt{exports}) = \text{write}_{\text{last process}} \;\neq\; \bigcup_{\text{configs}} \text{entries} $$

In the meantime, every intermediate state is visible to anything that reads the
manifest.

**2. Cleaning belongs to the run, not to a config.** One run cleans once, before
every bundle, so every config keeps `clean` on. When the configs run as separate
processes, cleaning has to move into the script, and the `clean: false` that
requires leaves orphaned output in `dist/`:

```jsonc
// wrong: two processes. Order decides which exports map survives, and the clean moves to the script
//   "build": "rimraf dist && tsdown --config bin && tsdown --config lib"  // both: clean false
// right: one process with one clean and one manifest write
//   "build": "tsdown"  // tsdown.config.ts exports [lib, bin], clean on
```

**3. A package is its own consumer.** Resolution through `exports` serves the
package's own `tests/` tree exactly as it serves an external caller. Completing
`publishConfig.exports` while leaving the top-level map empty passes every
registry check and still breaks the suite, because the published map is never the
one the workspace reads.

**4. A build artifact is verified after the build.** Reading the config that
declares `exports` proves nothing about the map on disk; the only honest check is
one that runs a build and then inspects the manifest.

## Prevention

- Any package with more than one tsdown config: put them in one
  `defineConfig([...])` array and run `tsdown` once. Check `exports` after a
  build, not after editing the config. The map is a build output.
- A package whose `tests/` tree self-imports by name needs the **source
  condition** in its top-level `exports`. Self-referencing resolves through that
  map, so a complete `publishConfig.exports` is not enough.
- Never disable `clean` to make a multi-config build work. Merge the configs
  into one run instead.
- A stale pnpm link state looks like a missing dependency: `pnpm install` can
  report "Already up to date" while a manifest-declared workspace dependency has
  no symlink. Delete the packages' `node_modules` and reinstall before
  debugging the resolver.

## Related

- `docs/solutions/build-errors/vitest-config-narrow-spread-drops-source-condition.md`
- `docs/solutions/tooling-decisions/workspace-source-condition-dev-resolution.md`
- `docs/solutions/build-errors/suite-imports-package-dist-rebuild-before-trusting.md`
