# Plan: Update Effect Dependencies and Rationalize Effect Peer Dependencies

## Requirements

1. **Update Effect Dependencies to Latest RC**: Ensure workspace uses `4.0.0-rc.117` for `effect`, `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest`, and `@effect/opentelemetry`.
2. **Remove Overrides**: Remove `overrides.effect` from `pnpm-workspace.yaml` and update `pnpm-lock.yaml`.
3. **Rationalize Peer Dependencies**:
   - In `packages/stryker-js/package.json`: retain `peerDependencies.effect` and declare `peerDependenciesMeta.effect.optional = true` so CLI consumers are not forced to install `effect` while library consumers retain semver constraint checks.
   - In `packages/stryker-js-vitest-runner/package.json`: delete `peerDependencies.effect` (the worker closure is inlined per `PLUG-1`, zero Effect in public API or types).
   - In `packages/stryker-test-contribution/package.json`: delete `peerDependencies.effect` (pure static evaluator descriptor, zero Effect in public API or types).
4. **Verification**:
   - `pnpm install` must succeed cleanly.
   - `pnpm typecheck` must pass across all packages (58/58 tasks).
   - `pnpm test` and `pnpm --filter @systemfsoftware/stryker-js --filter @systemfsoftware/stryker-js-vitest-runner --filter @systemfsoftware/stryker-test-contribution build` must pass without regressions.

## Proposed Changes

### Configuration

- `pnpm-workspace.yaml`: Remove `overrides.effect: 4.0.0-rc.117`.
- `pnpm-lock.yaml`: Synchronize with workspace definitions.

### Packages

- `packages/stryker-js/package.json`: Add `"peerDependenciesMeta": { "effect": { "optional": true } }`.
- `packages/stryker-js-vitest-runner/package.json`: Remove `"effect": "catalog:"` from `peerDependencies`. Keep devDependencies `effect: "catalog:"`.
- `packages/stryker-test-contribution/package.json`: Remove `"effect": "catalog:"` from `peerDependencies`. Keep devDependencies `effect: "catalog:"`.

### Change Intent

- Author a changeset documenting the dependency updates and peer dependency rationalization.

## Verification Plan

1. Run `pnpm install` to ensure lockfile and node_modules are consistent.
2. Run `pnpm typecheck` to verify zero type regressions across the workspace.
3. Run `pnpm test` to verify unit and integration tests pass.
4. Run `pnpm format:check` to ensure formatting complies with project standards.
