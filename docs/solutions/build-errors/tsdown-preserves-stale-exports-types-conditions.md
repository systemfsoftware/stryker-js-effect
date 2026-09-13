---
title: tsdown preserves stale exports types conditions; dropping a dts rollup shim needs a one-time manifest correction
date: 2026-09-13
category: build-errors
module: stryker-js-family
problem_type: build_error
component: tooling
severity: high
framework_version: tsdown 0.23.0
symptoms:
  - "Type-aware oxlint reports hundreds of no-unsafe-* findings phrased `Unsafe assignment of an error typed value` against a package's own public exports, while plain typecheck passes"
  - "A package manifest whose `exports[\".\"].types` points at a `dist/<package-name>.d.ts` file that `ls dist` never shows"
  - "A tsdown build re-run with the shim config removed leaves the phantom `types` path in package.json untouched"
root_cause: config_error
resolution_type: config_change
tags: [tsdown, exports, types-condition, api-extractor, dts, pnpm]
---

# tsdown preserves stale exports types conditions; dropping a dts rollup shim needs a one-time manifest correction

## Problem

The stryker-plugins and stryker-test-contribution packages landed with a tsdown
`customExports` shim that rewrote each manifest's `exports["."].types` to an
api-extractor rollup name (`./dist/stryker-plugins.d.ts`,
`./dist/stryker-test-contribution.d.ts`). tsdown's own build never emits those
filenames — with `entry: { index: './src/mod.ts' }` and an `outExtensions`
mapping dts to `.d.ts` it emits `dist/index.d.ts`. The manifest's types
condition dangled, so every consumer resolving the package's types — including
the package's own tests importing their self-name through the workspace link —
got TypeScript _error types_, and the workspace's type-aware oxlint tier
reported the fallout as ~150 `no-unsafe-*` findings per package (`Unsafe
assignment of an error typed value`) while plain `tsc` stayed green.

## Architectural invariant

A manifest's `types` condition is a resolution contract, not build output: for
every export subpath, `types` must name a file that exists in the emitted
`dist/` directly after a clean build. Any generator (a tsdown `customExports`
hook, an api-extractor rollup shim, a postbuild script) that writes a `types`
path the emitter does not produce — or that preserves a stale one when the
emitter changes — converts the package's entire public type surface into
TypeScript error types for every consumer, silently. Generator-managed manifest
fields therefore need an emission-side probe (`types` path ∈ `dist` listing) as
part of build verification, because neither `tsc` nor `attw` with
`no-resolution` ignored can observe the dangling condition from inside the
package.

## Root cause

Two stacked behaviors:

1. The shim wrote a types filename tsdown does not produce.
2. After deleting the shim config, tsdown 0.23's exports generation **preserved**
   the existing `types` condition from the manifest instead of replacing it with
   the computed one. Re-running the build with the shim-free config left the
   phantom path in place — the manifest never self-heals.

## Solution

- Delete the `apiExtractorRollups` / `shapeExports` `customExports` block from
  the tsdown config (plain `defineConfig` with `dts: true` emits per-entry `.d.ts`).
- Correct the manifest **once by hand**, in both `exports` and
  `publishConfig.exports`: point `types` at `./dist/index.d.ts`. This is a
  declared exception to the never-hand-edit-generated-exports rule: tsdown
  demonstrably preserves rather than regenerates the stale condition, so nothing
  else will fix it. Subsequent builds keep the corrected value.
- Verify by diffing every `types` condition against the actual `dist` listing,
  then re-running the type-aware lint (the ~150 error-typed findings per
  affected package drop to zero).

## Prevention

After any change to dts naming, entry names, or a `customExports` shim, probe
the manifest: every `types` condition must name a file that exists in `dist/`
immediately after a clean build. `attw --pack` with `no-resolution` ignored
does not catch this class — the paths must be checked against emitted output.

## Related

- `docs/solutions/tooling-decisions/pnpm-owns-the-changeset-ledger.md` — the
  patch intents in `.changeset/` record this types-condition correction as a
  published-surface change.
