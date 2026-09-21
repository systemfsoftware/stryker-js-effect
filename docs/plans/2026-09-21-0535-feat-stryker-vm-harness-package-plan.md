---
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
---

# Goal Capsule

Extract the in-memory VM test runner harness from `@systemfsoftware/stryker-js` into a dedicated workspace package (`@systemfsoftware/stryker-vm-harness`), restructuring its state management and execution pipelines to adhere religiously to `@systemfsoftware/effect-cell-types` (Cell, Sandwich, Workflow) and the repo's Pure Core / Imperative Shell constitutional architecture (CONST-P1, CONST-B3).

# Product Contract

## Primary Actors & Objectives

- **Stryker Engine Developers**: Need a decoupled, strictly-typed VM runner harness whose state transitions and execution lifecycles are modeled as pure Workflows and Sandwiches without ad-hoc global side-effects.
- **Test Framework Integrators**: Rely on a standalone, publishable `@systemfsoftware/stryker-vm-harness` to execute in-memory Vitest, `@effect/vitest`, and Gherkin suites without pulling in the entire Stryker CLI machinery.

## Requirements & Scope Boundaries

### In Scope

1. **Dedicated Package Extraction**:
   - Create `packages/stryker-vm-harness` in `pnpm-workspace.yaml`.
   - Export typed harness services, sandbox interceptors, and pure execution workflows.
2. **Effect DMMF & Cell Architecture**:
   - Replace procedural registry manipulation and drain steps with `@systemfsoftware/effect-cell-types` (`Cell`, `Sandwich`, `Workflow`).
   - Pure Core: Single-path (`CONST-P2`), cyclomatic complexity 1 for test drainage, status mapping, and mutant result interpretation.
   - Imperative Shell (`CONST-B3`): Sandwich pattern (`read` -> `transform/decide` -> `write`) around VM module imports, hook registration, and sandbox activation.
3. **Consumer Integration**:
   - Refactor `packages/stryker-js/src/VmRunner.ts` to consume `@systemfsoftware/stryker-vm-harness` as a workspace dependency.

### Scope Boundaries (Out of Scope)

- Altering the Vitest or `@effect/vitest` API surface supported by the harness.
- Changing child-process or out-of-process Vitest runner architectures (`stryker-js-vitest-runner`).

## Success Criteria & Verification Signals

- `packages/stryker-vm-harness` passes all strict lint rules (`@systemfsoftware/oxlint-plugin-effect-dmmf`, `lint:tsgo`, `dprint`).
- All existing unit, integration, and container e2e tests (`tests/vm-runner.integration.test.ts`, `tests/typescript-checker.e2e.test.ts`, `tests/vm-vitest.e2e.test.ts`) pass cleanly.
