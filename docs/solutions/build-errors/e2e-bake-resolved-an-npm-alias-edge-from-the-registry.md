---
title: The e2e bake resolved an npm-alias edge from the registry, so the release PR failed with ETARGET
date: 2026-10-08
category: build-errors
module: e2e-lane
problem_type: build_error
component: tooling
severity: high
symptoms:
  - "Every e2e job on the release PR fails in the fixture bake with `npm error notarget No matching version found for @systemfsoftware/stryker-js-vitest-runner@^9.0.0`"
  - "The runner tarball carrying exactly that version is in the same `npm install`"
  - "e2e on `main` passes, because the runner's version there is also the registry's latest"
root_cause: wrong_api
resolution_type: code_fix
tags: [e2e-lane, pnpm-pack, workspace-protocol, npm-alias, npm-install, etarget, tarball-closure]
---

# The e2e bake resolved an npm-alias edge from the registry

## Problem & Observable Boundary

The `@systemfsoftware/stryker-js` manifest names the runner behind `testRunner: 'vm'` through a workspace alias, `"@systemfsoftware/stryker-js-vm-runner": "workspace:@systemfsoftware/stryker-js-vitest-runner@^"`. It needs the alias because the same manifest lists `@systemfsoftware/stryker-js-vitest-runner` as a `catalog:stryker` devDependency (the dogfood pin, START-6). The bake installed `npm install /packs/*.tgz`. On `main`, npm downloaded the published runner into the alias slot and the bake copied the packed runner over it. On the release commit the runner version was ahead of the registry, and the install failed with ETARGET before the copy.

The closure was complete: the runner is an entry package, so its tarball was always in the install. The defect was in how the install consumed the closure.

## Mechanism & Failure Modes

Let $T$ be the set of packed tarballs handed to one `npm install`, and let $e = (a \to \texttt{npm:}t\texttt{@}r)$ be an edge of a member, where $a$ is the alias name and $t$ is a closure member.

1. **Pack-time rewrite.** `pnpm pack` performs $\rho: \texttt{workspace:}t\texttt{@\^{}} \mapsto \texttt{npm:}t\texttt{@\^{}}v_t$.
2. **Name-keyed placement.** npm places a tarball for $t$ at `node_modules/t`. Edge $e$ needs `node_modules/a`. Since $a \neq t$, no member of $T$ fills that slot, and npm resolves $\texttt{npm:}t\texttt{@}r$ against the registry $R$.
3. **Failure condition.** $v_t \notin R \Rightarrow$ ETARGET. When $v_t \in R$ the install succeeds, but the alias slot holds the published $t$, not the packed one. Nothing fails, so the defect is silent until a release.

## Architectural Invariants

### I1: Every closure edge is satisfied by a local spec

_For every edge npm installs for a packed member (`dependencies`, `optionalDependencies`, and `peerDependencies` not marked optional in `peerDependenciesMeta`) whose target, by name or through `npm:`, is a closure member, the same `npm install` carries a spec that fills that edge's slot from the member's tarball._

```ts
specs = [...tarballs, ...aliasEdges.map((e) => `${e.alias}@file:${tarballOf(e.target)}`)]
```

npm places `alias@file:<tgz>` at `node_modules/alias` and records the tarball's real `name`. The dependent's `npm:` edge then validates against it with no registry request.

### I2: A workspace target outside the plan refuses it

_The plan fails global setup, naming the edge, when:_

- _a packed member's installed edge targets a workspace package with no tarball in the closure (`UnpackedWorkspaceDependency`);_
- _two edges give one alias name different targets, or an alias name is also a member's own name (`ConflictingAliasTargets`), because npm keeps whichever spec comes last;_
- _a fixture manifest (`dependencies`, `devDependencies`, required peers, `optionalDependencies`) names a workspace package (`FixtureNamesWorkspacePackage`), because the fixture's own `npm install` runs before the closure specs and resolves that edge from the registry._

A registry fallback for a workspace package is never a valid outcome. An optional peer npm will not install is not an edge.

### I3: Tarball lookup is exact

_A member's tarball is `<scope>-<name>-<semver>.tgz`, not any file that starts with `<scope>-<name>-`._ With prefix matching, `@systemfsoftware/stryker-js` could select `systemfsoftware-stryker-js-vitest-runner-*.tgz`. That would drop the CLI's own tarball from the bake cache key, and now that the install is planned from the looked-up tarballs, from the install too.

`installClosure` and its refusals in `@systemfsoftware/stryker-e2e-core` implement I1 and I2. The harness plans the install only when a fixture needs baking, and passes the plan to `bake-fixtures.sh` as arguments. The step that copied the packed runner over the alias directory is deleted.

## Anti-Pattern Code Smells

- **Glob install with an alias in the closure.** `npm install /packs/*.tgz` assumes every edge is name-keyed. Any `npm:` spec in a packed manifest breaks that assumption.
- **Post-install repair.** Copying a package over a directory npm already filled from the registry hides the registry dependency and leaves the lockfile lying about provenance.
- **Prefix tarball lookup.** `startsWith(prefix) && endsWith('.tgz')` across sibling packages whose names share a prefix.

## Verification & Prevention

- `install-closure.integration.test.ts` in `@systemfsoftware/stryker-e2e-core` runs under `pnpm test`. It packs a closure with the production alias shape and installs the plan with `npm install --package-lock-only --offline`, an empty cache and an unreachable registry. It then requires `file:` provenance for every workspace package in the lockfile. Any registry fallback for a closure member fails the install. Its other scenarios cover each I2 refusal and the optional-peer exemption.
- Two-sided check (scratch evidence, not a committed fixture): the same offline install given the tarball list alone exits `ENOTCACHED` for `@systemfsoftware/stryker-js-vitest-runner`, and given the plan it exits 0.

## Related

- `docs/solutions/build-errors/e2e-lane-packed-a-subset-of-its-workspace-closure.md`: the closure-completeness fix this one extends to alias edges
- `docs/plans/2026-09-25-0809-refactor-vm-runner-runs-vitest-plan.md`: why the CLI names the runner through an alias
- Failing run: https://github.com/systemfsoftware/stryker-js-effect/actions/runs/37744072050
