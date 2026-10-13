---
title: A strictly typed optional key in a third-party manifest schema made shapes Node accepts fail the whole manifest decode
date: 2026-10-11
category: performance-issues
module: stryker-js
problem_type: performance_issue
component: tooling
symptoms:
  - "A test file that imports a workspace package through `exports` gets an open import closure once that package's `package.json` also holds an `imports` entry that is `null`, an array, or a nested condition object"
  - "A test file that imports a workspace package whose `exports` uses nested condition objects, an array or a `null` subpath gets an open import closure, so it re-runs after an edit to a file it never reaches"
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

- Decode the key into a tagged entry type that covers every JSON shape, so that key can never fail the decode. `PackageEntry` is `EntryPath | EntryFallbacks | EntryMap | EntryNull | EntryScalar` (a string, an array, an object, `null`, a number or boolean), and an absent key is `EntryUndeclared`. The foreign `package.json` stays the Encoded side; the decode is total, and the generated round-trip laws hold from the Type side (pack: schema-laws, `rich-type-over-foreign-encoded.md`).
- Read entries one at a time in the pure decision `selectManifestTarget`, which dispatches on the entry's tag. A path, or a condition map whose chosen value is a path, resolves. Anything else gives `ManifestTargetMissing` for that one specifier, which opens only the closures that import it.
- Regression gate: the import-closure integration scenario "Imports entries the resolver cannot read leave the rest of that package.json in force". A workspace package carries a nested-condition entry, a `null` entry and an array `imports` entry beside a valid `exports` map. A test file imports it through `exports` and must get a closed closure whose digest stays the same after an unrelated edit. With the strict key the scenario fails (`open: true`, the digest moves). With the fix it passes.

## Why This Works

Mechanism, in order:

1. `S.Struct` ignores keys it does not declare. Before the key was declared, no `imports` value could affect the decode.
2. Declaring `imports` with a type narrower than Node's grammar turned every unlisted shape into a decode failure. The failure belongs to the whole struct, not to the key.
3. The closure cell maps a failed decode to "no manifest", so every specifier into that package resolves to `Unresolved`.
4. An `Unresolved` resolution opens the closure (`opensClosure`). An open closure folds `projectDigest`, a hash over every scanned module, into its own digest in `closureDigestOf`. So the digest moves on any project edit.

Before the change, the blast radius of an unsupported `imports` entry was nothing. After it, the blast radius was every test file that imports the package. The useful radius is only the closures that import that one `#` specifier.

**Invariant: refuse at the granularity of use.** A schema that decodes a document another tool owns may refuse only what the reader would fail to use. A key whose grammar the reader handles only in part decodes into a tagged type whose variants cover every shape the document can hold, and the decision judges each entry by its tag. The struct types only the keys that are needed whole.

```ts
// WRONG: one unsupported entry refuses exports, main and module too
const PackageManifestSchema = S.Struct({
  exports: S.optionalKey(S.Union([S.String, S.Record(S.String, ExportEntrySchema)])),
  imports: S.optionalKey(S.Record(S.String, ExportEntrySchema)),
})
// RIGHT: the key always decodes into a tagged entry; the decision refuses one specifier
const PackageEntryFieldFromKey = S.optionalKey(S.Json).pipe(
  S.decodeTo(
    PackageEntryFieldSchema,
    SchemaTransformation.transformOptional({ decode: declaredFieldOf, encode: declaredJsonOf }),
  ),
)
const PackageManifestSchema = S.Struct({ imports: PackageEntryFieldFromKey })
// selectManifestTarget: EntryPath -> target; EntryMap -> chosen condition; any other tag -> ManifestTargetMissing
```

The value is still decoded and never cast (pack: cell-architecture, `decode-never-cast.md`). Only the place where the typed refusal lands changes.

**Code smell to grep for:** `S.optionalKey(` or `S.optional(` holding a union or record narrower than the owning tool's grammar, inside a struct decoded by `S.decodeOption(S.fromJsonString(...))` over a file Stryker does not write (`package.json`, `tsconfig.json`, a report from another release).

## Prevention

- Before you add a key to a schema over a document Stryker does not own, list every shape the owning tool accepts for that key. If the domain distinguishes fewer shapes, decode the key into a tagged type with a variant for each shape the document can hold, and refuse per entry in the decision.
- Gate each such key with a scenario that puts an unsupported shape beside a supported field and asserts that the supported field still takes effect. A test that only uses valid shapes cannot see this failure. Here, the scenario named under Solution is the gate.
- `exports`, `main` and `module` had the same flaw and are fixed the same way: every key of `PackageManifestSchema` decodes into `PackageEntryField`, and `selectManifestTarget` reads each entry at any depth by its tag. A path is the target, fallbacks yield their first element that yields a file (as in Node's `resolvePackageTarget`, `null`, a number, a boolean and an object no condition matches are skipped, and `[]` yields none), `EntryNull` yields no target, and an `exports` map with no `.`-prefixed key is the root's conditions (Node's sugar for `{ ".": {...} }`); mixing both kinds of key yields no target, as Node refuses it. Nested conditions, array fallbacks, a top-level array, root conditions and a `null` subpath no longer fail the whole decode; the workspace's own `vitest-config`, `tsdown-config`, `stryker-config` and `oxlint-ignorer-config` manifests all use the nested shape `{ ".": { "import": { "types": "...", "default": "..." } } }`. Gate: the built-CLI feature "Reusing verdicts for tests that import a linked workspace package", whose outline runs each shape twice around an edit no test reaches.
- A condition object resolves to the file the runtime loads, never the first value. `@systemfsoftware/source` wins (the workspace's own condition); otherwise the entry is read as Node reads it, once under the ESM conditions (`import`, `node`, `module-sync`, `node-addons`, `default`) and once under the CommonJS ones (`require` in place of `import`), skipping every other key (`types`, `browser`, `module`, a user condition). Both reads giving one file, or one giving a file and the other none, is the target; two different files yield no target, because the importer's module system decides between them and the static reader cannot know it: the scanner sends `require()` and `import` specifiers through one request, and a runner that compiles `import` syntax to CommonJS takes the `require` branch anyway. Open is slow; a closure closed over a file no runtime loads is stale. The first-value rule closed `{ "types", "default" }` on the `.d.ts`, and only dry-run evidence (`CompleteDryRunResult.testFileModules`, which the Vitest runner reports and `analyzeImportClosure` adds to the closure) kept those verdicts honest. Gate: the same feature's runtime-edit outline with the `closure-only` test-runner fixture, which reports no `testFileModules`; it changes only the package's `.js` and expects every mutant tested again, and on the first-value rule its nested and flat `types`-first rows reused stale verdicts. The scenario "A linked package with import and require branches still re-tests its CommonJS importer…" is the gate for the dual case: it edits only the `.cjs` file a `require` importer loads.
- When the reader encodes another program's algorithm (here Node's package resolver), pin it against that program, not against the author's reading of its docs. Gate: `tests/manifest-target-node-resolution.differential.test.ts`, which resolves generated `exports` and `imports` entries with a real `node` and compares the closure. Its runs found three rules the laws had stated wrongly: `[]` blocks instead of falling through; a `null` element is skipped, not final; and a string Node rejects as a target (`/x.js`, `../x.js`, `./a/../x.js`, or one without `./` in `exports`) yields no file, and is skipped inside an array.

## Related Issues

- `docs/solutions/performance-issues/checker-digest-lost-to-tsconfig-extends-through-package-exports.md`: the same failure family. A private resolver that understands less of `package.json` than Node does silently turns a reuse key into "always changed".
- PR #308: the `#` subpath imports and Node builtins fix this learning came from.
