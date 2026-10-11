---
status: "accepted"
date: 2026-10-10
decision-makers: ["ryan"]
supersedes: ["ADR-0001 (src/drivers row, lines 48, 58, 77)"]
---

# Driver-backed implementations sit flat beside their service

## Context and Problem Statement

This record supersedes ADR-0001 in part only: the `src/drivers/<driver>.ts` row of its taxonomy table (line 48), the failures rule that confines throwing to `src/drivers/` (line 58), and the audit that expects Promise and `throw` sites only under `src/drivers/` (line 77). The rest of ADR-0001, and ADR-0002, stay in force.

ADR-0001 put every adapter to Node, vitest, typescript and other foreign APIs into a `src/drivers/` folder named for a technical kind. That folder says nothing about which capability a module serves, and it let a cell import a driver directly: `import-closure.cell.ts` called `parseSource` from `src/drivers/oxc-parser.ts`, so the cell was bound to oxc and no composition root chose the parser.

The systemfsoftware cell-architecture plan for service and layer placement (`docs/plans/2026-10-10-0806-refactor-cell-service-layer-structure-plan.md` at commit `381bbb61e7`, requirements R5 and R6, lines 67-68) settles where such an implementation lives.

## Decision Drivers

- A cell, workflow or service depends on a capability, never on the technology behind it.
- A composition root chooses the concrete implementation, and tests provide it the same way.
- A module sits beside the capability it serves; no folder is named for a technical kind.

## Considered Options

- Keep `src/drivers/<driver>.ts` (ADR-0001 line 48 as written).
- A role suffix for driver-backed implementations, such as `*.adapter.ts`.
- A flat module beside the service module, with no prescribed filename.

## Decision Outcome

Chosen option: "a flat module beside the service module", because it is the placement the cell-architecture plan prescribes (R5, R6) and needs no new suffix in the taxonomy.

- A capability's contract is a `Context.Service` class in `<capability>.service.ts`. The service module imports no driver.
- An implementation that imports a driver lives in its own module. That module imports the service module and exports module-level `make` and `layer` (and `layerConfig` when it reads `Config`). There is no `*Live` binding.
- Only composition roots and tests import that module. A cell, workflow or service yields the service instead.
- The module sits flat beside the service module, in the same directory, with no `drivers/`, `adapters/` or `store/` folder. Its filename is not prescribed. A module that is already a cell kind (`*.handle.ts`, `*.blueprint.ts`) keeps its kind suffix.
- An implementation that needs only Effect and abstract tags stays `static readonly layer` on the service class.
- Promise and callback interop, `Reflect`, and `throw` translation are confined to these driver-backed modules and the composition roots, replacing "outside `src/drivers/`" in ADR-0001 lines 58 and 77.

In stryker-js the first service under this record is `SourceParser` (`source-parser.service.ts`), implemented by `oxc-source-parser.ts` and provided by the Node platform layer (`node-platform.ts`, formerly `src/drivers/node.ts`). The other two former `src/drivers/` modules moved flat beside their users with only their import paths changed: `promises/run.ts` and `run/read-config-document.ts`.

### Consequences

- Good, because cells name the capability they need, and the root picks oxc (or a test double) once.
- Good, because each module sits next to the capability it serves.
- Bad, because an unsuffixed module's role is no longer visible from its path, so review checks the import edges (service ← implementation ← root) instead.

### Confirmation

- Review checks that a driver-backed module is imported only by a composition root or a test, and that no `src/drivers/` folder exists.
- The gate (`cell-architecture/service-exports-no-layer`, plan R12) belongs to the cell-architecture lint packages, not to this repository.

## Pros and Cons of the Options

### Keep `src/drivers/<driver>.ts`

- Good, because nothing moves.
- Bad, because the folder names a technical kind, and cells import the technology directly.

### A role suffix such as `*.adapter.ts`

- Good, because the role is visible in the filename.
- Bad, because it adds a suffix to the closed taxonomy that the plan does not prescribe, and the lint packages do not know it.

### A flat module beside the service module

- Good, because it matches the cell-architecture plan and keeps the taxonomy closed.
- Bad, because the filename does not mark the module as driver-backed.
