---
title: A strictly typed optional key in a third-party manifest schema made shapes Node accepts fail the whole manifest decode
date: 2026-10-11
category: performance-issues
module: stryker-js
problem_type: performance_issue
component: tooling
symptoms:
  - "A test file that imports a workspace package through `exports` gets an open import closure once that package's `package.json` also holds an `imports` entry that is `null`, an array, or a nested condition object"
  - "That test file's closure digest moves on an edit to any project file, so incremental runs re-test it whatever changed"
  - "Node's `imports` grammar admits these shapes; only Stryker's own manifest decode refuses them"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [import-closure, package-json, effect-schema, decode-granularity, package-imports, package-exports, incremental-reuse]
---

# A strictly typed optional key in a third-party manifest schema made shapes Node accepts fail the whole manifest decode

## Problem

The import closure finds the files a test file depends on and digests them. Incremental runs reuse a test file's results while that digest stays the same. To resolve a package import, the closure cell decodes the package's `package.json` with one struct, `PackageManifestSchema`, through `S.decodeOption(S.fromJsonString(PackageManifestSchema))`. PR #308 teaches the closure to resolve `#` subpath imports. Its first version added `imports` to that struct with the type `exports` already used: each entry a string or a flat condition record. Node accepts three more shapes for an entry: `null` (a blocked subpath), an array of fallbacks, and a nested condition object such as `{ "node": { "import": "./x.js" } }`. With any of them in the file, the whole manifest failed to decode. The import then resolved nowhere and the closure opened, even for imports that only needed the package's `exports`, `main` or `module`. Review caught it before merge. Main never had the regression.

## Symptoms

- A package imported through `exports` loses its closure when one unrelated `imports` entry has a shape Node accepts and the schema does not.
- The digest moves on unrelated edits, so incremental reuse silently stops for every test file that imports that package.
- The cause is discarded. The cell turns the decode `None` into a missing manifest, then into an `Unresolved` resolution that carries no reason, and the closure reports only `open: true`.

## What Didn't Work

- Typing the new key the way the existing `exports` key was typed. It looked consistent, and it was the defect. A narrow type on one key does not refuse that key. It refuses the whole document.

## Solution

- Decode the key as plain JSON, `imports: S.optionalKey(S.Json)`, so that key can never fail the decode.
- Read entries one at a time in the pure decision `selectManifestTarget`. A string target, or a condition object whose chosen value is a string, resolves. Anything else gives `ManifestTargetMissing` for that one specifier, which opens only the closures that import it.
- Regression gate: the import-closure integration scenario "Imports entries the resolver cannot read leave the rest of that package.json in force". A workspace package carries a nested-condition entry, a `null` entry and an array `imports` entry beside a valid `exports` map. A test file imports it through `exports` and must get a closed closure whose digest stays the same after an unrelated edit. With the strict key the scenario fails (`open: true`, the digest moves). With the fix it passes.

## Why This Works

Mechanism, in order:

1. `S.Struct` ignores keys it does not declare. Before the key was declared, no `imports` value could affect the decode.
2. Declaring `imports` with a type narrower than Node's grammar turned every unlisted shape into a decode failure. The failure belongs to the whole struct, not to the key.
3. The closure cell maps a failed decode to "no manifest", so every specifier into that package resolves to `Unresolved`.
4. An `Unresolved` resolution opens the closure (`opensClosure`). An open closure folds `projectDigest`, a hash over every scanned module, into its own digest in `closureDigestOf`. So the digest moves on any project edit.

Before the change, the blast radius of an unsupported `imports` entry was nothing. After it, the blast radius was every test file that imports the package. The useful radius is only the closures that import that one `#` specifier.

**Invariant: refuse at the granularity of use.** A schema that decodes a document another tool owns may refuse only what the reader would fail to use. A key whose grammar the reader handles only in part is decoded as `S.Json` and interpreted per entry inside the decision. The struct types only the keys that are needed whole.

```ts
// WRONG: one unsupported entry refuses exports, main and module too
const PackageManifestSchema = S.Struct({
  exports: S.optionalKey(S.Union([S.String, S.Record(S.String, ExportEntrySchema)])),
  imports: S.optionalKey(S.Record(S.String, ExportEntrySchema)),
})

// RIGHT: the key always decodes; the decision refuses one specifier
const PackageManifestSchema = S.Struct({
  imports: S.optionalKey(S.Json),
})
// selectManifestTarget: Predicate.isString(entry) -> target; condition object -> chosen string; else ManifestTargetMissing
```

The value is still decoded and never cast (pack: cell-architecture, `decode-never-cast.md`). Only the place where the typed refusal lands changes.

**Code smell to grep for:** `S.optionalKey(` or `S.optional(` holding a union or record narrower than the owning tool's grammar, inside a struct decoded by `S.decodeOption(S.fromJsonString(...))` over a file Stryker does not write (`package.json`, `tsconfig.json`, a report from another release).

## Prevention

- Before you add a key to a schema over a document Stryker does not own, list every shape the owning tool accepts for that key. If the schema admits fewer shapes, decode the key as `S.Json` and refuse per entry in the decision.
- Gate each such key with a scenario that puts an unsupported shape beside a supported field and asserts that the supported field still takes effect. A test that only uses valid shapes cannot see this failure. Here, the scenario named under Solution is the gate.
- One instance remains, as of this writing. `exports` in the same `PackageManifestSchema` is still typed `S.String | Record<string, string | Record<string, string>>`, on main and on the PR #308 branch. A package whose `exports` uses nested conditions fails the whole manifest decode. So does one with an array fallback or a `null` subpath. The closure reads manifests only for packages it follows: workspace-linked packages whose real path is outside `node_modules`. An installed dependency resolves as external and is unaffected. For a followed package, every import then leaves its closure open. The workspace's `@systemfsoftware/vitest-config` manifest uses the nested shape `{ ".": { "import": { "types": "...", "default": "..." } } }`. This was checked by decoding those three shapes with `PackageManifestSchema` on the PR #308 branch: each one returned `None`.

## Related Issues

- `docs/solutions/performance-issues/checker-digest-lost-to-tsconfig-extends-through-package-exports.md`: the same failure family. A private resolver that understands less of `package.json` than Node does silently turns a reuse key into "always changed".
- PR #308: the `#` subpath imports and Node builtins fix this learning came from.
