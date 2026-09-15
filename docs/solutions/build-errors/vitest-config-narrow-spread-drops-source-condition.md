---
title: A vitest config that spreads only the shared config's `test` member drops the source condition, so that package's suite silently grades dist
date: 2026-09-15
category: build-errors
module: stryker-js-family
problem_type: test_failure
component: tooling
severity: high
applies_when:
  - "A package's suite fails to load with `Failed to resolve entry for package` or `Cannot find package` while every sibling suite passes"
  - "The failure appears only on a checkout without that package's built output"
  - "A new package joins the workspace and copies a sibling's test config"
symptoms:
  - "The `@systemfsoftware/stryker-js-engine` suite failed to load two integration suites with `Failed to resolve entry for package \"@systemfsoftware/stryker-js-engine\"` and `Cannot find package \"@systemfsoftware/stryker-js-engine/builtin-reporters\"`, while the other four suites loaded and passed"
  - "The suite passed in the turbo gate and failed the moment the package's dist was removed — the gate's own build task had been supplying the artifact the defect needs"
  - "Every other workspace suite resolved the same package from source, so the defect read as package-local when it was consumer-local"
  - "The package's coverage listed built-output entries instead of `src/` entries"
root_cause: config_error
resolution_type: config_change
tags: [vitest, export-conditions, ssr-resolve-conditions, shared-config, source-condition, workspace-resolution, cache-masking, turbo]
---

# A vitest config that spreads only the shared config's `test` member drops the source condition

## Problem

The workspace resolves sibling packages from source through one named export
condition, and the shared test config is the single place that hands that
condition to the runner — it carries it in two resolver keys,
`resolve.conditions` and `ssr.resolve.conditions`, beside the `test` object it
also exports. A package whose config spreads **only the `test` member** of that
exported config object receives the test options and none of the resolver keys,
so every specifier the runner resolves on behalf of that package falls back
through the export map to the built `dist`.

The failure boundary is what makes it expensive: the package's own `test` task
in the task graph waits on that package's `build`, so the artifact the defect
depends on is always present when the gate runs. The suite grades dist in the
gate and cannot load at all without a build — two different behaviours from one
config line, and only the second is visible. The suite is green in CI and red
for a newcomer, on identical source.

## Mechanism

1. **Resolution is a first-match over the consumer's condition set.** For a
   specifier `s`, the export map's object keys in order $k_1 \dots k_n$, and the
   condition set $C$ supplied by the resolving process:

   $$\text{resolve}(s, C) = \text{exports}[k_i], \qquad i = \min \{\, j : k_j \in C \,\}$$

   The map is correct and unchanged; only $C$ decides which key wins, and
   `default` sits last so it wins whenever nothing earlier matches.

2. **The condition set is narrowed by spread granularity, not by intent.** The
   shared config exports one object holding `test`, `resolve`, and `ssr`. A
   config built from `{ test: { ...sharedConfig.test } }` has
   $C_{\text{default}} \setminus C_{\text{dev}}$ — the dev condition is absent
   from the runner's set even though the export map declares it first.

3. **The runner then resolves the fallback.** With the dev condition missing,
   `k_1` is skipped and `default` matches: `@systemfsoftware/stryker-js-engine`
   resolves to its built entry, and a subpath with no built entry fails to load
   with `Cannot find package`.

4. **The task graph hides it.** `test` depends on the package's own `build`, so
   in the gate the fallback artifact exists and the suite passes. The graph edge
   converts a hard failure into a silent fidelity loss.

5. **The cache extends the hiding.** A cached `test` result replays against a
   resolution that no longer holds, so the defect survives repeated green runs.

The two behaviours are one predicate apart:

$$\text{hard failure} \iff \text{dist absent}, \qquad \text{silent dist-grading} \iff \text{dist present}$$

Wrong — the resolver keys never reach the runner, so the package's own
specifiers fall back to dist:

```ts
export default defineConfig({
  test: { ...sharedConfig.test, include: ['tests/**/*.integration.test.ts'] },
})
```

Right — the shared object is spread whole, and the `test` object is overridden
after it:

```ts
export default defineConfig({
  ...sharedConfig,
  test: { ...sharedConfig.test, include: ['tests/**/*.integration.test.ts'] },
})
```

## Architectural Invariants

**INV-1 — A shared config is spread whole; narrowing a spread changes
semantics.** Spreading a member selects options, but the sibling keys of the
same exported object are not options — they are resolver wiring.
`{ ...sharedConfig.test }` and `{ ...sharedConfig }` look like the same
intention and produce different resolvers. A config factory that must be
narrowed has to say which keys are resolver keys, or the next member added to
the shared object is dropped the same way.

**INV-2 — A resolution defect is witnessed only by artifact absence.** Any
defect whose symptom is "resolves the wrong artifact" is invisible in every
environment that provides the fallback artifact. A task graph edge that supplies
that artifact is therefore not neutral: it is the reason the defect cannot be
seen. Deleting the artifact is the test, not a diagnostic step taken after
something else fails.

**INV-3 — The condition set is a consumer property, not a package property.** A
correct export map is necessary and not sufficient: the map is shared by every
consumer, while each consumer supplies its own condition set. The ignore-list of
places to check is the set of _resolving processes_ — the test runner, the
type-checker, the type-aware linter, the declaration extractor — not the package
being resolved.

**Anti-pattern code smell.** A top-level spread that names a member of an
exported config object while sibling configs spread the object:

```ts
defineConfig({ test: { ...sharedConfig.test } })      // narrow — drops resolver keys
defineConfig({ ...sharedConfig, test: { ... } })      // whole — carries them
```

The same shape in the task graph — a test task whose dependency list includes
its own package's `build` — is the masking agent, and is worth auditing whenever
a suite cannot run without one.

## Verification and prevention

- **Prove the resolution, not just the pass.** Delete the package's built
  output, then `vitest run` inside the package: it must pass. Then read the
  coverage keys (`jq 'keys' coverage/coverage-final.json` after
  `COVERAGE=true vitest run --coverage`) — every key must be a `src/` entry, no
  `dist/` entry. A green run with dist present proves nothing.
- **Treat a needed build as the smell, before the config.** `test`'s dependency
  list is readable without running anything —
  `turbo query 'query { package(name: "<pkg>") { tasks { items { fullName directDependencies { items { fullName } } } } } }'`
  shows a test task waiting on its own `build`; whenever a suite cannot load
  without that build, look for the missing condition, because the build edge is
  the symptom.
- **The wiring checker has this blind spot.**
  `check_dev_conditions.ts` decides the vitest leg by text-matching that the
  config spreads `sharedConfig`; a spread narrowed to `sharedConfig.test`
  satisfies that match. Run it as
  `check_dev_conditions.ts <package-dir> --condition=@systemfsoftware/source`
  — its default `@scope/source` reports false failures on every export subpath
  here — and treat a `SKIP` on the vitest leg as unchecked, not as passing.
- **The self-reference rule is not the problem.** Node resolves a package's own
  name from a source-conditioned map with no `node_modules` self-link:
  `node --conditions=@systemfsoftware/source -e "import.meta.resolve('<pkg>/<subpath>')"`
  returns the `src` file, and the same call without the flag returns the `dist`
  file. A failing self-import therefore points at the consumer's condition set,
  never at the export map.
- **The end-to-end gate.** `pnpm check:ci` must exit 0, and a change to a
  resolver config is confirmed only by an uncached run — `turbo lint typecheck
  test --force` — since a cache hit replays the resolution under test.

Corroborating measurements from the fix (engine, no built entries): 2 suites of
6 failed to load with 9 tests run before; 6 files and 18 tests passed after;
coverage keys `src/` only; `turbo lint typecheck test --force` green at 69 of 69
tasks with zero cache hits.

## Related

- `docs/solutions/tooling-decisions/workspace-source-condition-dev-resolution.md`
  — the decision that introduced the condition and named the vitest wiring;
  this document is the failure mode of not consuming that wiring whole.
- `docs/solutions/build-errors/suite-imports-package-dist-rebuild-before-trusting.md`
  — the earlier symptom of the same resolver question, before the condition
  existed.
- `docs/solutions/build-errors/workspace-bin-and-typecheck-ordering.md` — the
  task-graph ordering defect that this document's masking mechanism reuses.
