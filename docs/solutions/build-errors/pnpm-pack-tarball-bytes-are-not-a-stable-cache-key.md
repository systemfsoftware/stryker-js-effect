---
title: pnpm pack tarball bytes are not a stable cache key, so the e2e bake cache missed on every run
date: 2026-09-23
category: build-errors
module: e2e-lane
problem_type: build_error
component: tooling
symptoms:
  - "Two `pnpm pack` runs of an unchanged workspace package produce tarballs with different SHA-256 digests"
  - "A cache keyed on packed tarball bytes never hits: every e2e run re-bakes every fixture in a fresh preparation microVM"
  - "Tar entry mtimes are identical across the two tarballs (1985-10-26), so archive metadata is not the difference"
root_cause: nondeterministic_input
resolution_type: code_fix
severity: medium
tags: [e2e-lane, pnpm-pack, cache-key, content-addressed-cache, determinism, package-json, workspace-protocol]
---

# pnpm pack tarball bytes are not a stable cache key

## Problem

The e2e lane (`@systemfsoftware/stryker-e2e`) keys its baked-fixture cache on a SHA-256 of its inputs, and one input is every packed workspace tarball. The first version hashed the `.tgz` bytes. Two packs of an unchanged tree produced different digests, so the key changed on every run and the cache never hit. Nothing failed: each run paid for a full re-bake.

## Symptoms

- Packing `@systemfsoftware/stryker-js` twice with no source change gave different tarball digests (`11bd5c07…` vs `434a8db9…`) and different digests for the decompressed tar stream too.
- `tar -tvzf` shows the same fixed mtime on every entry, so the gzip and tar metadata are not the cause.
- `diff -r` of the two unpacked trees shows one differing file, the packed `package.json`. Its `dependencies` map lists the same entries in a different key order: `pnpm pack` rewrites `workspace:` ranges to concrete versions and writes the rewritten map in an order that varies between runs (observed on pnpm 11.21.0).

## What Didn't Work

- Hashing the tarball bytes, and hashing the decompressed tar stream. Both include the reordered `package.json`.
- Normalizing tar metadata. It was already fixed.

## Solution

Key on the unpacked content instead of on the archive, and canonicalize every `package.json` before hashing it. In `test/e2e/tests/__fixtures__/microvm-environment.ts`, `bakeKeyOf` unpacks each tarball into scratch and hashes the sorted file list. `contentOf` hashes a `package.json` as `JSON.stringify` of `canonicalJson(JSON.parse(...))`, which sorts object keys recursively, and hashes every other file by its bytes:

```ts
const contentOf = async (path: string): Promise<Buffer | string> =>
  basename(path) === 'package.json'
    ? JSON.stringify(canonicalJson(JSON.parse(await readFile(path, 'utf8'))))
    : readFile(path)
```

A throwaway check confirmed both halves of the fix. Two independent packs gave the same key (`d4af9626fb02…`). A one-byte edit to `test/e2e/testResources/failing-fixture/src/thing.ts` changed it (`a261a1b1c9d7…`). A whitespace-only edit to a fixture `package.json` did not change it, which is expected, because canonicalization discards formatting that has no semantic effect.

## Why This Works

npm installs by what the manifest says, not by the order of its keys, so two manifests that differ only in key order install identically. Canonicalizing removes the only run-to-run variance in the packed output, and the key still changes whenever any shipped byte or manifest value changes.

## Prevention

- Before content-addressing any build artifact, pack or build it twice and diff the two results. A key over non-reproducible bytes fails silently, as cache misses rather than errors.
- Hash the semantic content (unpacked files with canonical JSON), never the container format (`.tgz`, `.zip`).

## Related Issues

- `docs/solutions/build-errors/e2e-lane-packed-a-subset-of-its-workspace-closure.md`: the closure the same lane packs; the key covers every tarball in that closure.
- `docs/solutions/build-errors/api-check-alias-rotation-not-stable-across-invocations.md`: another tool whose output is not stable across runs over identical input.
