---
status: "accepted"
date: 2026-10-09
decision-makers: ["ryan"]
supersedes: ["ADR-0001"]
---

# Service ports declare no Layer; drivers hold every Layer

## Context and Problem Statement

ADR-0001's taxonomy row for `*.service.ts` (line 44) lets a service file hold a `Context.Service<Self, Shape>()` contract "and their static layers". Twenty `*.service.ts` files declare a tag and export a Layer beside it, and five more export a Layer and declare no tag. Importing one of those contracts imports its implementation too, along with whatever that implementation reaches: `CheckerRuntime.service.ts` pulls in `typescript/unstable/async`, `run-event-stream.service.ts` pulls in `Stdio` and `FileSystem`. A consumer cannot take a contract without the code that satisfies it, so no package can be split along a contract boundary.

Two cell-architecture pack rules disagree on this. `ports-separate-from-layers` says port files "export no `Layer` values". The tier-2 clause of `service-and-layer-boundaries` allows a `static layer(options)` on the service class when no driver is involved. The Stream A ruling binds the first.

This record supersedes only ADR-0001's `*.service.ts` row and extends its `src/drivers/` row. Every other clause of ADR-0001 stands, including line 60 on where functions over a schema's data live.

## Decision Drivers

- `cell-architecture/ports-separate-from-layers`: lean port declarations, adapters at the infrastructure boundary, inward import direction.
- `cell-architecture/service-and-layer-boundaries` gate 3: no static `*Live` identifiers in libraries; §1: no `*.port.ts` or `*.layer.ts` suffixes.
- `package-topology/import-time-inertness`: importing a contract builds nothing.
- One rule with no exceptions is the only form a lint can enforce.

## Considered Options

- Keep tier-2 static layers on services that bind no driver, move only driver-backed Layers.
- Add a `*.live.ts` suffix beside each `*.service.ts`.
- Put every Layer that satisfies a service in a driver module.

## Decision Outcome

Chosen option: "Put every Layer that satisfies a service in a driver module", because it is the only option a single lint rule can check, it adds no suffix the packs ban, and it removes every implementation import from every contract file.

### The rows that change

| Suffix or place          | Holds                                                                                                                                                                                                                                  | Never holds                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `*.service.ts`           | One `Context.Service<Self, Shape>()` contract: the tag, its shape types, and functions that reach the service only through its tag                                                                                                     | A `Layer` value, a function returning a `Layer`, a static `layer` or `*Layer` member, a `*Live` name, driver imports |
| `src/drivers/<binds>.ts` | Adapters to Node, vitest, typescript, and other foreign APIs, and every `Layer` that satisfies a service contract. A driver exports `layer` (a value, or a function where it takes options); one that binds several names each by role | Decisions                                                                                                            |

`RunEnvironment.stage` and `RunEnvironment.forStream` assemble Layers, so they live in `src/drivers/run-stage.ts`; the `RunEnvironment` port keeps its tag, `RunEnvironmentShape`, and `phaseEntered`.

### Consequences

- Good, because a contract import builds nothing and imports no driver, so a package can publish contracts without their implementations.
- Good, because a consumer can provide its own implementation of any service without loading the default one.
- Bad, because published names change: static `layer` members and the `*Live` aliases (`OutputModeProbeLive`, `RunEventDrainLive`, `WorkerReportsLive`) are removed, and each package ships a breaking changeset.
- Bad, because five hosts that run a stage inside a cell (`Mcp/mcp-server.cell.ts`, `Serve/Serve.cell.ts`, `run-request.cell.ts`, `plan-request.cell.ts`, `run/run-stages.ts`) import `drivers/run-stage.ts`. Inward import direction does not hold for them, and the binding stays mid-pipeline until the engine split moves it to a composition root.

### Confirmation

The gritlint `cell-architecture` pack refuses a `*.service.ts` that exports a `Layer` value, a function returning one, a static `layer` member, or a `*Live` name. Its bad fixtures prove it refuses each form, and `pnpm lint:conventions` runs it in `check:ci`.

## Pros and Cons of the Options

### Keep tier-2 static layers on services that bind no driver

- Good, because pure in-memory services keep their Layer next to the tag.
- Bad, because whether a Layer "involves a driver" is a judgement over its transitive imports, so no lint can check it, and the two pack rules stay in conflict.

### Add a `*.live.ts` suffix beside each `*.service.ts`

- Good, because each implementation sits next to its contract.
- Bad, because `service-and-layer-boundaries` §1 bans layer-specific suffixes, and the taxonomy would gain a suffix that holds what `src/drivers/` already holds.

### Put every Layer that satisfies a service in a driver module

- Good, because the rule has no exceptions and a lint checks it.
- Bad, because pure in-memory Layers such as `IdGenerator`'s move to `src/drivers/` even though they wrap no foreign API.
