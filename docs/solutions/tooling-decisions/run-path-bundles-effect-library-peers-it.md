---
title: A run path bundles its effect; an Effect-native library peers on it
date: 2026-11-11
category: tooling-decisions
module: stryker-js family
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - "A published package imports effect and a consumer pins a different effect version"
  - "A package manager must choose which effect copy a peer-bound package such as @effect/platform-node binds to"
  - "A package exposes both an executable and an Effect-typed API"
  - "A published declaration file must not import a package the manifest does not declare"
tags: [effect, peer-dependencies, bundling, npm, pnpm, tsdown, api-extractor, declarations]
---

# A run path bundles its effect; an Effect-native library peers on it

## Problem

`@systemfsoftware/stryker-js` and the html reporter declared `effect` as a peer, and packages that depend on `@effect/*` inherited the same peer edge. A project on another `effect` therefore changed what stryker-js loaded. When `effect` 4.1.0 removed the `effect/Crypto` module, the pinned release that still imported it failed the type-query integration tests on main. The consumer's `effect` version is not an input of a mutation run, so any edge from the run to it is a defect.

## Mechanisms

1. **Peer edge.** Every `peerDependencies.effect` is a resolver decision made in the consumer's tree. A package that peers on it, such as `@systemfsoftware/effect-cell-types`, inherits the same decision.
2. **pnpm.** A package's peer binds to its dependent's own `dependencies` entry before the importing project's, so a direct exact `effect` dependency isolates pnpm installs (resolve_peers walker: the parent's scope overlaid with the package's own dependencies).
3. **npm.** Measured on npm 11.19.0: a direct exact dependency does not isolate. A peer-bound package was hoisted to the root and resolved the consumer's `effect`; another nested its own copy only because its range excluded the consumer's. Equal exact versions did not give one copy. An optional peer still fails the install when the consumer's version is outside the range.
4. **Declarations.** A bundled implementation with declarations that import `effect` still couples the consumer: a `.d.mts` naming a package the manifest does not declare resolves to nothing, or to the consumer's copy.
5. **Analysis tools.** api-extractor cannot read declarations that inline the whole `effect` type surface (it fails with an internal "unable to follow symbol" error on the inlined `PropertyKey`), so a report generated from them cannot exist.

## Invariants

- **I1. Classify by surface, then declare by class.** A package a consumer runs bundles every copy it uses and declares no `effect` relationship: none of `dependencies`, `peerDependencies`, `peerDependenciesMeta`, `optionalDependencies`. A package that exposes an Effect-typed API declares `effect` as a required peer. No package is in between (an optional peer and an exact dependency are the two middle grounds both measured wrong).
- **I2. Bundle the closure, not just the package.** Bundling `effect` while depending on a package that peers on it leaves the peer edge. Every package that peers on `effect` (`@effect/*`, `@systemfsoftware/effect-cell-types`, the Effect-typed workspace libraries) is inlined into the run path as well, and the build fails on any external outside an allowlist (tsdown `deps.onlyImport`, the same mechanism as the worker bundles).
- **I3. Declarations obey the manifest.** `effect` leaves a run-path package's `devDependencies` only as inlined declarations; the published `.d.mts` imports no `effect` specifier. `devDependencies` carry the build inputs because Turborepo requires an imported package to be declared; a dependency's `devDependencies` are never installed.
- **I4. One source, two artifacts when the surface splits.** The Effect-native API ships from a package built from the same sources with `effect` external; the run path ships from the original package. A source move is a separate decision because mutation lanes, audit commands and fault-seeding scripts address the original package directory.
- **I5. Analyse the declared surface, not the shipped declarations, when they differ.** Where inlined declarations defeat the analyser, generate a declarations-only build of the same entries with `effect` external and report from that. The shipped declarations are verified by scanning their specifiers.

## Verification

- A packed-tarball journey installs the run-path packages into a consumer pinned to `effect@4.0.0` under npm, runs a real mutation run, and walks the dependency, optional and peer edges recorded in the installed tree. It fails when any reachable package is `effect` or declares it, and when more than one `effect` version is installed.
- Library packs in the same install peer on a newer `effect`. The consumer manifest sets the npm override `"effect": "$effect"` so those peers resolve to the consumer's copy; without it the install fails with ERESOLVE (measured). The override does not touch the run path, which declares nothing to override.
- Read the installed manifests, never the check's own metadata. A peer whose range admits the consumer's version (such as `^4.0.0`) installs cleanly, so only the installed record catches it.
- The red proof restores a `^4.0.0` peer on the run-path package in a scratch branch and expects the journey red.

## Smells

- `"effect"` under `peerDependencies` or `dependencies` of a package that has a `bin`.
- A run-path package listing `@effect/*` or `@systemfsoftware/effect-cell-types` in `dependencies`.
- `from "effect"` or `from "effect/..."` in a run-path `.mjs` chunk or `.d.mts`.
- A scripted check that reads only the packed `package.json` and never the installed tree.

## Related

- `docs/plans/2026-11-11-0039-fix-stryker-js-own-effect-plan.md`
- `docs/plans/2026-09-24-1825-feat-effect-rc117-peer-dependencies-rationalization-plan.md` (the optional-peer decision this supersedes)
- `docs/solutions/build-errors/tsdown-inlines-devdep-types-into-dts-single-copy-rule.md`
- `docs/solutions/tooling-decisions/optional-esm-peer-resolution-from-the-install.md`
