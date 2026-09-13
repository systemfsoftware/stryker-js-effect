---
title: A workspace bin cannot target a build output; typecheck must follow its own build
date: 2026-09-13
category: build-errors
module: stryker-js-family
problem_type: build_error
component: tooling
severity: high
framework_version: pnpm 11.21.0 / turbo 2.10.1
symptoms:
  - "CI install logs `Failed to create bin ... ENOENT: no such file or directory, open '.../dist/main.mjs'`, and the consumer's mutation task later dies with `sh: 1: stryker: not found`"
  - "Four packages fail typecheck with `TS2307: Cannot find module '<their own package name>'` from their own integration tests, while the same typecheck passes on a warm checkout"
  - "`pnpm install --force` re-links no bins after a manifest change; the warning never clears"
root_cause: config_error
resolution_type: config_change
tags: [pnpm, workspace, bin, turbo, task-graph, typecheck, entrypoint]
---

# A workspace bin cannot target a build output; typecheck must follow its own build

Two ordering defects found when the stryker-js family landed: both pass on a
warm developer checkout, both fail on a fresh CI install, and neither is a bug in
the code under test.

## Problem

`@TODO/starter` runs its mutation leg through a binary owned by its workspace
dependency `@systemfsoftware/stryker-js-cli`. The CLI declares
`bin.stryker = ./dist/main.mjs` and publishes `files: [dist]`. In CI the install
reports `Failed to create bin … ENOENT`, the later mutation task ends in
`stryker: not found`, and the CLI's build in the same run succeeds — the bin was
never created, so nothing was there to run.

Independently, `typecheck` on four family packages failed with
`TS2307: Cannot find module '<the package itself>'` from their own integration
tests, because `typecheck` depended on `^build` only: a package could typecheck
its self-imports before its own build produced the `dist` those imports resolve
through. `test` and `lint` already carried the self `build` dependency; the two
tasks disagreed about the same requirement.

## Failure mechanics

1. **Install-time bin linking is one-shot and target-existence-gated.** pnpm
   creates each dependency's bin shim while linking, and skips the shim when the
   target file is absent (`pnpm v11.21.0`, observed in the CI install log). A
   `bin` under a gitignored `dist/` has no target on a fresh clone, so no shim is
   ever created — the shim is **not** retried when the build later creates it.
2. **Neither `--force` nor a lockfile change re-links.** The lockfile records
   dependency graphs, not bin targets: `pnpm install --force` observed the graph
   unchanged and re-linked nothing. Only a fresh install performs the attempt.
3. **An importing wrapper is illegal here.** Routing the bin through a committed
   `bin/stryker.mjs` that imports `../dist/main.mjs` fails
   `@systemfsoftware/effect-entrypoint`'s `entrypoint-not-imported` rule: the
   entrypoint is what the process interprets, and no module may consume it.
4. **`prepare` cannot substitute for a build order.** Adding
   `prepare: tsdown` to the CLI's manifest runs at install, before any package's
   build output exists; the CLI bundles `@systemfsoftware/stryker-js-html-reporter`
   as an entry, so the build dies on `[UNRESOLVED_ENTRY]` for a `dist` that no
   task has produced yet.
5. **Self-import resolution goes through the package's own build.** A test that
   imports its own package by name resolves the `exports` map (`default →
   ./dist/index.mjs`, or the publisher's re-pointed map). With `deps` on `^build`
   alone the graph permits $\text{typecheck} \parallel \text{build}$ for the same
   package, so the verdict is a race the warm checkout always wins.

## Architectural invariants

- **INV-1 — a bin target must exist at install.** If a published artifact's bin
  lives in generated output, the artifact must ship that output (`files` includes
  `dist`). A workspace consumer cannot rely on the same shim, because install
  precedes every build. Consumers inside the workspace invoke the built
  entrypoint through the dependency it declares; the process interprets the
  entrypoint, which keeps the entrypoint contract intact.
- **INV-2 — a task that reads a package's own build output declares that
  dependency, not just its transitive one.** `^build` is the _neighbours'_ build;
  it never orders a package against itself.

```
# WRONG — self-import resolution races the package's own build
typecheck.dependsOn = ["^build"]

# RIGHT — reads own dist ⇒ waits on own build
typecheck.dependsOn = ["^build", "build"]
```

```
# WRONG — shim is absent on a fresh install: the target does not exist yet
"bin": { "stryker": "./dist/main.mjs" }
"mutation": "stryker run"

# RIGHT — published consumers get dist in the tarball; workspace consumers
# run the entrypoint the graph has already built
"mutation": "node ./node_modules/@systemfsoftware/stryker-js-cli/dist/main.mjs run"
```

## Verification and prevention

Reproduce the CI condition locally before trusting a green run — both defects
need absent outputs, which a warm checkout always has:

```bash
rm -rf packages/<pkg>/dist packages/<pkg>/node_modules/.bin/<bin>
pnpm install --frozen-lockfile
turbo typecheck --force
```

Confirm the ordering with the task graph rather than by reading `turbo.json`:
`turbo query 'query { package(name: "<pkg>") { tasks { items { fullName directDependencies { items { fullName } } } } } }'`
must list the package's own `#build` under its `#typecheck`, and the consumer's
`#mutation` under the dependency's `#build`.

Code smells that predict this class:

- a `bin` entry pointing into a gitignored build directory, consumed by a
  `workspace:^` dependency;
- `typecheck` whose `dependsOn` omits `build` while `test` and `lint` include it —
  the asymmetry _is_ the defect;
- an install log line `Failed to create bin` treated as noise.
