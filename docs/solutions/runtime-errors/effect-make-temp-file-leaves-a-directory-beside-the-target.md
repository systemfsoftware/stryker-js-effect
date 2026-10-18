---
title: Effect's makeTempFile with a directory leaves a temp directory beside the target
date: 2026-10-10
category: runtime-errors
module: stryker-js
problem_type: runtime_error
component: verdict_store
severity: high
symptoms:
  - "A re-run with no change refuses every verdict as `closureChanged` after the first run wrote its incremental report"
  - "The project holds entries like `reports/main.json.069c3Z` and `<entry>.json.jDFFZ` next to files that were written atomically"
  - "The leftovers appear after every write, including ones that succeeded, not only after a killed run"
root_cause: wrong_api
resolution_type: code_fix
framework_version: "@effect/platform-node-shared 4.0.0"
tags: [atomic-write, temp-file, effect-filesystem, incremental-report, verdict-store, closure-digest]
retire_when: "`makeTempFile` in @effect/platform-node-shared creates the file directly in `options.directory` instead of calling mkdtemp first (check `makeTempFileFactory` in its NodeFileSystem source)"
---

# Effect's makeTempFile with a directory leaves a temp directory beside the target

## Problem

`writeFileAtomic` (used by the incremental report, the checkpoint writer and the filesystem verdict store) asked `FileSystem.makeTempFile` for a temp file beside the target, wrote into it, and renamed it over the target. Every call left an empty directory named after the target inside the project. The next run counted it as project content, so an unchanged re-run refused its verdicts as `closureChanged` (per this session's diagnosis of the CI failure in the incremental-reuse integration feature).

## Failure mechanics

1. `makeTempFile(options)` in @effect/platform-node-shared 4.0.0 (`makeTempFileFactory`) first calls `makeTempDirectory(options)`, which is `mkdtemp(join(options.directory, options.prefix))`, and only then writes an empty file named `<random hex><suffix>` inside that new directory.
2. So `prefix` names a directory (a run left `reports/main.json.069c3Z`, a mkdtemp name that exists only until the fix removes it), `suffix` names the file inside it, and `rename(temp, target)` moves the file out and leaves the directory.
3. The leak is per write, not per interruption: $\text{leftovers} = \text{atomic writes}$, whether or not any write failed.
4. Anything that reads the target's directory as input (the project file crawl, a store listing) now sees one extra entry per write, so content-keyed digests over that directory change between runs that changed nothing.

## What didn't work

- **Suspecting interruption.** The first hypothesis was a write cut off between creating the temp file and renaming it. A scratch script interrupted 400 and then 3000 writes at staggered points and found zero leftover `.tmp` files: the `Effect.onExit` cleanup worked, and the leak did not depend on timing.
- **Reading the call site.** `makeTempFile({ directory, prefix: 'main.json.', suffix: '.tmp' })` reads as "a file named `main.json.<random>.tmp` in `directory`". The leftovers carried the prefix but not the suffix; that mismatch is the tell that the prefix names something other than the file.

## Solution

Before (`writeFileAtomic` on main at #273):

```ts
const temp = yield * fs.makeTempFile({ directory, prefix: `${path.basename(file)}.`, suffix: '.tmp' })
yield * fs.writeFileString(temp, content)
yield * fs.rename(temp, file)
```

After (`replaceFileAtomically`, which the traced `writeFileAtomic` wraps and the filesystem verdict store driver calls directly):

```ts
const temp = path.join(path.dirname(file), `.${path.basename(file)}.${bytesToHex(randomBytes(8))}.tmp`)
yield * Effect.uninterruptible(
  writeSynced(temp, content).pipe( // open(temp, { flag: 'wx' }), writeAll, sync
    Effect.andThen(fs.rename(temp, file)),
    Effect.onExit((exit) => Exit.isSuccess(exit) ? Effect.void : fs.remove(temp).pipe(Effect.ignore)),
  ),
)
```

## Why this works

Invariant: an atomic replace creates exactly one transient entry, the temp file, and every exit path consumes it, either by `rename` onto the target or by `remove` in `onExit`. With nothing else created, nothing else can leak. `flag: 'wx'` refuses a name that already exists, and `uninterruptible` keeps a fiber interrupt from landing between the write and the rename.

## Prevention

- The incremental-reuse scenario `A first repeat run under default ignore patterns reuses every verdict` lists the project after the first run and asserts `leftTempEntries: []`; its `TEMP_ENTRY` pattern matches both the old `<name>.json.<6 chars>` directories and stray `.<name>.<hex>.tmp` files. It failed with the fix stashed and passes with it.
- Code smell: `fs.makeTempFile({ directory: <a directory that persists> })` or `fs.makeTempDirectory({ directory: <same> })` in code that writes into a project, report directory or store. These APIs make scratch space meant to be removed wholesale, such as `makeTempDirectoryScoped` under the OS temp dir.
- A temp entry inside a directory that a later run reads as input changes that input. After any write into such a directory, assert the directory gained only the target.
