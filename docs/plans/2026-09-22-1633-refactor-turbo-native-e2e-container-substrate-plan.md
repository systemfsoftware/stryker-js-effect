---
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

## Goal Capsule

- **Objective:** The E2E test harness establishes container image identity and staging from Turborepo task-graph hashes and standard monorepo primitives, eliminating custom recursive file-system hashing and ad-hoc manifest walks.
- **Means:** Replace `closure-resolver.ts` and `fingerprintTag` in `test/e2e/tests/__fixtures__/container-environment.ts` with queries against `turbo run build --filter=... --dry=json` and standard package staging.
- **Authority:** User directive rejecting hand-rolled hashing algorithms in favor of native Turborepo and package manager facilities.
- **Execution Profile:** Standard implementation across test environment fixtures and image packaging.
- **Stop Conditions:** E2E container tests determine container reuse purely from Turborepo task hashes without custom sha256 directory walks.
- **Remaining Work:** Implementation planning in `ce-plan`.

---

## Product Contract

### Summary

Transition the E2E test container environment from hand-rolled recursive directory hashing and manual workspace closure discovery to Turborepo-native task-graph hashes. Use Turborepo's existing `--dry=json` capability to determine closure packages and cache keys, ensuring identical image identity across concurrent Vitest workers while reducing maintenance overhead.

### Problem Frame

The current container harness in `test/e2e/tests/__fixtures__/container-environment.ts` hand-rolls two distinct mechanisms that standard tooling already provides:

1. `closure-resolver.ts` traverses workspace manifests in-process via custom Node.js filesystem walks to determine transitive `workspace:` dependencies.
2. `fingerprintTag` traverses source trees with manual directory exclusions (`HASH_SKIP = { dist, .stryker-tmp, node_modules, reports }`) to calculate a SHA-256 fingerprint for Docker image tagging.

This hand-rolled approach is brittle:

- It fails to hash root build configurations (`pnpm-workspace.yaml`, catalog versions, `tsconfig.json`).
- It silently ignores missing source paths.
- It duplicates work that Turborepo already performs during task dependency resolution.

### Key Decisions

- **KD1. Turborepo dry-run task graph as sole source of closure truth:** (session-settled: user-directed — chosen over custom `closure-resolver.ts`: `turbo run build --dry=json` maps package closures, build order, and inputs with full lockfile and environment awareness). Governs R1, R2.
- **KD2. Turborepo composite task hash as container image tag:** (session-settled: user-directed — chosen over hand-rolled SHA-256 directory hashing: Turbo's per-task hash already incorporates package inputs, global dependencies, and lockfile state). Governs R3, R4.
- **KD3. Retention of published tarball fidelity:** (session-settled: user-approved — chosen over pure `turbo prune --docker` source compilation: preserves end-to-end simulation of real consumer `.tgz` installation in test fixtures). Governs R5.

### Requirements

#### Closure Discovery & Identification

- R1. The E2E environment fixture MUST resolve packable workspace packages by querying Turborepo's dry-run execution graph (`turbo run build --filter=@systemfsoftware/stryker-js... --dry=json`).
- R2. Closure discovery MUST NOT perform recursive manual scans of workspace `package.json` files.

#### Image Identity & Caching

- R3. The Docker container image tag MUST be derived from the composite hashes returned by Turborepo's dry-run output (combining `globalCacheInputs` and individual package task hashes) plus immutable test assets (test resources and Dockerfile).
- R4. Vitest workers running concurrently MUST derive identical image tags for identical git working states without invoking separate image builds.

#### Staging & Packaging

- R5. Packaging of workspace artifacts for the container context MUST build and pack only the packages identified in Turborepo's closure graph.
- R6. Custom directory walking routines (`hashDirectory`, `hashIfPresent`, `HASH_SKIP`) in `container-environment.ts` MUST be removed.

### Key Flows

- F1. Container Environment Image Tag Resolution
  - **Trigger:** Vitest worker initializes test harness via `ensureContainerEnvironment()`.
  - **Actors:** E2E Test Worker, Turborepo CLI, Docker/Podman Daemon.
  - **Steps:**
    1. Harness executes `turbo run build --filter=@systemfsoftware/stryker-js... --dry=json` via subprocess.
    2. Harness parses JSON output, extracting topological closure and task input hashes.
    3. Harness formats image tag as `stryker-js-effect-e2e:<hash>`.
    4. Harness inspects container runtime for image tag.
    5. If image exists, worker immediately adopts image and skips build.
    6. If image is missing, harness builds packages, packs tarballs, and triggers single container build.
  - **Outcome:** Deterministic container adoption with zero redundant builds across test workers.
  - **Covered by:** R1, R3, R4.

### Acceptance Examples

- AE1. Deterministic Tag Across Workers
  - **Covers:** R3, R4
  - **Given:** A clean repository with uncommitted changes in `packages/stryker-js/src/`.
  - **When:** Two independent test workers run `fingerprintTag()`.
  - **Then:** Both workers receive the exact same tag string derived from Turborepo's task hash.

- AE2. Dependency / Configuration Invalidation
  - **Covers:** R1, R3
  - **Given:** A modification to `pnpm-workspace.yaml` updating an Effect catalog dependency version.
  - **When:** Turborepo dry-run runs.
  - **Then:** Turborepo's `globalCacheInputs` or task hash changes, causing the image tag to update and triggering an image rebuild.

- AE3. No Custom Directory Walking
  - **Covers:** R6
  - **Given:** `test/e2e/tests/__fixtures__/container-environment.ts`.
  - **When:** Inspecting AST and imports.
  - **Then:** No references to `createHash` from `node:crypto` or custom directory traversal loops exist.

### Scope Boundaries

- **In Scope:**
  - Replacing in-process `closure-resolver.ts` with Turborepo dry-run output.
  - Replacing manual `hashDirectory` with Turborepo composite hash generation.
  - Updating `container-environment.ts` and associated unit tests.

- **Out of Scope (Deferred):**
  - Migrating fixture execution away from Docker containers.
  - Replacing `pnpm pack` with an in-memory Verdaccio registry.
  - Modifying fixture-specific test assertions or Stryker mutation logic.
