---
title: The e2e lane packed a subset of its workspace closure, so a release version bump failed the job with ETARGET
date: 2026-09-20
category: build-errors
module: e2e-lane
problem_type: build_error
component: tooling
severity: high
symptoms:
  - "The e2e CI job fails with `npm error code ETARGET` / `No matching version found for @systemfsoftware/stryker-js-plugin-interface@7.1.0`"
  - "The lane passes on a commit before the release and on a later commit with no lane change in between; only the release boundary is red"
  - "The container holds the tarball carrying the demanded version and still fails to resolve that version"
root_cause: missing_workflow_step
resolution_type: code_fix
tags: [e2e-lane, pnpm-pack, workspace-protocol, npm-install, etarget, release-race, tarball-closure]
---

# The e2e lane packed a subset of its workspace closure

## Problem & Observable Boundary

The containerized e2e lane (`@systemfsoftware/stryker-e2e`) packs workspace packages with `pnpm pack`, copies the tarballs into a container, and installs them into fixture projects. It packed only the entry packages — the CLI and its two plugins — and left the rest of their internal dependencies for npm to resolve, which npm did from the public registry. The failure is confined to one boundary: a commit whose workspace versions are ahead of what is published. Ordinary feature commits pass; the release commit is the one that fails, and it fails inside the fixture install step before any mutation run starts.

## Mechanism & Failure Modes

Let $C$ be the workspace dependency closure of the entry set $E$ over `dependencies` + `peerDependencies` edges carrying a `workspace:` spec, and let $\text{installed}$ be the package set handed to a single `npm install`.

1. **Pack-time range rewriting.** `pnpm pack` performs $\rho: \texttt{workspace:^} \mapsto \texttt{\^{}v}$, where $v$ is the packed version. Each tarball therefore declares an exact-range dependency on its siblings that survives outside the workspace.
2. **Incomplete install set.** The old shape satisfied $\text{installed} = E \subsetneq C$, so for every $p \in C \setminus \text{installed}$ npm had to satisfy $\rho(p)$'s range from the registry set $R$. The failure condition is $R \cap \text{range}(\rho(p)) = \varnothing$, which npm reports as `ETARGET`.
3. **Race window.** Version bump and publication are asynchronous: the bump lands at $t_0$ and $R$ catches up at $t_1 > t_0$. Any run whose install executes in $[t_0, t_1)$ fails, and it recovers on its own afterwards — the self-healing signature that makes the defect read as flake.
4. **Silent regrowth.** The install set was a hand-written constant, so a new internal dependency of an entry package rejoins $C \setminus \text{installed}$ without any lane edit; the next release boundary re-exposes it.

Observed instance: the job failed with `No matching version found for @systemfsoftware/stryker-js-plugin-interface@7.1.0` while the packed tarball on disk carried exactly that version.

## Architectural Invariants

### I1 — Closure Completeness at Install Time

_Every package reachable by a `workspace:` edge from the entry set must be present in the same `npm install` invocation as a local tarball._

$$\text{registry-independent install} \iff \text{installed} \supseteq C = \text{lfp}\big(E,\ \text{edges}_{\texttt{workspace:}}\big)$$

```ts
// closure ⊇ every package an entry's rewritten range can name
const closure = resolveWorkspaceClosure(await readPackableWorkspaceManifests(REPO_ROOT), ENTRY_PACKAGES)

// one invocation, so [tarball ranges] resolve against [tarball siblings], never against the registry
const args = [
  'npm',
  'install',
  ...packedTarballs().map((packed) => packed.tarballPath),
  ...extraTarballs.map((p) => p.tarballPath),
]
```

The closure is the least fixed point of the production edges — `dependencies` and `peerDependencies` whose spec starts with `workspace:`, over packable manifests (`private !== true`) — which keeps dev tooling (toolchain configs, ignorers, fixtures) out by construction rather than by denylist.

### I2 — Derived Packaging Set

_What the lane packs and installs is computed from the manifests, never enumerated._ With $C$ derived, adding a package under `packages/` or a new internal dependency joins the install set with no lane edit. A hard-coded package list is the defect, not a style preference: it makes the registry dependency invisible until a release exposes it.

### I3 — Install-Step Ownership

_Each step of a multi-phase install owns exactly one failure class, and its message names it._ The step boundary is what makes a red lane self-diagnosing:

| Step                                                      | Signature                                                                                          | Owner                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install the <fixture> registry dependencies`         | `ERESOLVE` on the fixture's own pinned dev/runtime deps                                            | the fixture's dependency pins — a test-matrix decision, e.g. a `^N` range whose publisher later peers a newer exact version than the fixture pins |
| `npm install the workspace closure tarballs in <fixture>` | `ETARGET` naming a `@systemfsoftware/stryker-*` package, or any failure resolving a closure member | this defect class (I1)                                                                                                                            |

## Anti-Pattern Code Smells

- **Enumeration in place of derivation.** `const PACKED_PACKAGES = [CLI, ...PLUGINS]` feeding both the build/pack loop and the install argument list, where the argument list is not $\supseteq C$ (I1/I2).
- **Splitting the install.** Two `npm install` calls where the first may consult the registry for a package the second provides locally; ranges only resolve against siblings inside one invocation.
- **Reading a self-healing red as transient.** A job that goes green on the next commit without a lane change is a race that was observed, not a flake to ignore.

## Verification & Prevention

- **Provenance assertion.** In every fixture's `package-lock.json`, each `@systemfsoftware/stryker-*` entry must read `resolved=file:…tgz`. Presence of a `registry.npmjs.org` URL for one of those names is the regression.
- **Unpublished-version sabotage (two-sided).** Bump one closure member to a version that exists nowhere, then assert both halves: the subset install exits non-zero with `ETARGET`, and the full-closure install succeeds with the contrived version present. Restore the version afterwards; this is scratch evidence, never a committed fixture (CONSTITUTION `CONST-T11`).
- **Closure pinning by a unit suite in the lane that uses it.** `test/e2e/tests/closure-resolver.test.ts` asserts that the entry packages resolve to exactly the expected member set, so a resolver regression fails before any container starts. `test/e2e/AGENTS.md` E2E-1 forbids a `test` script on this app, so the suite runs under the lane's own `test:e2e` — the lane's vitest `include` covers `tests/**/*.test.ts` for that reason. Do not add a `test` script to satisfy a gate; that rule list is a read-only judgment surface (`CONST-G4`).
- **Build order is part of the invariant.** The closure is built in one `turbo run build --filter=…` per member so `dependsOn: ["^build"]` orders it; packing a member that was never built would ship its previous build output instead of the current source.
- **Mutation-relevant direction:** removing the closure derivation (falling back to the entry-only list) must make the sabotage case above fail; if it still passes, the guard is decorative.

## Related

- Plan: `docs/plans/2026-09-20-1920-fix-e2e-workspace-closure-packaging-plan.md`
- Opening failure: https://github.com/systemfsoftware/stryker-js-effect/actions/runs/35529643213
- Lane red on `main` from the I3 registry-drift row (unresolved as of this writing, owner: the fixture pins): https://github.com/systemfsoftware/stryker-js-effect/actions/runs/35531487882/job/106132762397
- `docs/solutions/build-errors/suite-imports-package-dist-rebuild-before-trusting.md` — the sibling failure of a gate that stays green because the artifact it exercises is not the artifact under test
