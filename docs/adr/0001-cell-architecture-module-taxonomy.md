---
status: "accepted"
date: 2026-09-26
decision-makers: ["ryan"]
---

# Module taxonomy and Effect idioms for the cell architecture

## Context and Problem Statement

Every Effect package in this monorepo borrows the cell vocabulary (`Sandwich.named`, `Workflow.make`, `Context.Service`), but the code between those pieces is procedural. Some examples:

- `packages/stryker-js/src/Cli.cell.ts` wraps the CLI in a cell, then does the real work in a ~70-line `Effect.gen` outside any cell phase.
- Grab-bag `*.parts.ts` files (`run/mutation-test.parts.ts` is 1490 lines) mix pure helpers, effect procedures, and in-source tests, and cells re-export their internals.
- Concurrency is hand-built from `Ref`, `Deferred`, and mutable maps.
- `Effect.fn` has no uses anywhere.

`CONSTITUTION.md` CONST-G5 puts contestable module-shape choices in ADRs. This record fixes the module shape and the Effect idioms the rewrite in `docs/plans/2026-09-26-0550-refactor-idiomatic-effect-rewrite-plan.md` follows. It covers which file suffixes exist, where pure helpers live, what the process entrypoint is, and which Effect primitives replace hand-rolled ones.

## Decision Drivers

- CONST-P1 and CONST-P2: decisions are pure, at complexity 1. CONST-B1, CONST-B3, and CONST-B6: a thin shell, with the sandwich order carried by types. CONST-T4: behavior lives where the mutator sees it.
- Each package's mutation config grades only `src/**/*.workflow.ts`, so behavior outside workflows goes ungraded.
- The cell-architecture pack: `service-and-layer-boundaries.md`, `pipeline-composition.md`, `four-channel-contracts.md`, `handle-state-privacy.md`, `scoped-lifecycle-boundaries.md`.
- `@systemfsoftware/effect-cell-types` 10.2.0 defines a cell as "a pure decision with I/O on either side of it" that runs one pass.

## Considered Options

- Keep the current layout: cells plus `*.parts.ts` and `*.steps.ts` helper modules.
- Use a closed taxonomy (cell, workflow, schema, service, blueprint, handle, driver, entrypoint) and retire parts and steps.
- Drop the cell library and write plain `Effect.fn` services everywhere.

## Decision Outcome

Chosen option: "Closed taxonomy, parts and steps retired", because it is the only option that puts every decision under the mutation gate. It also keeps the typed sandwich order the constitution requires, and it matches the vocabulary the packs already enforce.

### The taxonomy

| Suffix or place                    | Holds                                                                                                                                                           | Never holds                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `*.cell.ts`                        | One outside interaction built with `Sandwich.named(name)(read).decide(workflow).write(handlers)`, or a composition of cells with `Cell` combinators             | Sequential `cell.run` inside `Effect.gen`; `Cell.fromEffect` wrapping a whole stage |
| `*.workflow.ts`                    | `Workflow.make` decisions at complexity 1, plus the pure helpers those decisions use                                                                            | I/O, service requirements, clocks, randomness, `throw`                              |
| `*.schema.ts`                      | Schemas, tagged classes, and tagged errors                                                                                                                      | Behavior (CONST-T4). Behavior moves to a workflow                                   |
| `*.service.ts`                     | `Context.Service<Self, Shape>()` contracts and their static layers                                                                                              | Driver or transport imports in the contract                                         |
| `*.blueprint.ts` and `*.handle.ts` | Cold `Blueprint.make` descriptions and hot `Handle.make` values with scoped acquisition                                                                         | Module-level mutable registries                                                     |
| `src/drivers/<driver>.ts`          | Adapters to Node, vitest, typescript, and other foreign APIs. This is the only place Promise or callback interop, `Reflect`, and `throw` translation may appear | Decisions                                                                           |
| `src/bin/*`                        | The process composition root and the `effect/unstable/cli` command tree                                                                                         | Cells named after the CLI; decisions                                                |
| `mod.ts`                           | One namespace barrel per published capability                                                                                                                   | Re-exports of internals                                                             |

### The idioms

- **Entrypoint.** The CLI is not a cell. `src/bin/main.ts` builds the layer once, runs the command tree, and passes the handler's `Exit` to one conclusion cell. That cell classifies the outcome, writes the terminal envelope, drains the stream, and fails with `RunExit`, whose exit code `NodeRuntime.runMain`'s teardown publishes.
- **Composition.** One-pass stages chain with `Cell.andThen`, `Cell.mapError`, `Cell.gate`, `Cell.collect`, and `Cell.flatMap`. Multi-item work (files, mutants, checker groups, reporter events) is a `Stream` pipeline in the shell that runs a per-item cell with bounded concurrency. A cell never returns a `Stream`.
- **Named operations.** A reused or exported effectful function is `Effect.fn('<dotted.name>')(function* …)`. A hand-written `Effect.withSpan` stays only where a published span name must survive.
- **State and concurrency.** Use `Queue`, `PubSub`, `Stream`, `Pool`, `FiberMap`/`FiberSet`, `Scope`, and `SynchronizedRef`. There is no `Ref.getUnsafe` or `Ref.makeUnsafe`, no module-level mutable state, and no mutation of records the caller owns.
- **Failures.** Every distinct failure is a `Schema.TaggedError` variant (CONST-D2). Outside `src/drivers/`, nothing throws.
- **Tests.** Properties under `src/` live in `src/__tests__/<stem>.workflow.property.test.ts`, the only basename `test-discipline` accepts there, and `<stem>` names the module the laws grade. Workflows get properties. Cells, services, and the composition root get no unit tests of their own: the integration suites, the e2e lane, and the api-extractor reports grade them. Two cases get laws outside a workflow, each only when an independent oracle pins consumer-visible behavior:
  - A handle whose behavior is reachable in-process without a spawned worker. `checker-pool.workflow.property.test.ts` grades `Checker/checker-pool.handle.ts` (group order, pool fan-out bound, crashed-slot invalidation, breach-to-`StageError`, release-once) against instrumented pools and reference partitions, because a regression there leaks checker processes long before the e2e lane notices.
  - A pure helper no workflow can host. `make-body-purity` refuses a reference to a local module or to any dependency outside the sealed `effect/*` surface, so `Survivors.cell.ts`'s `hashContent` (it needs `@noble/hashes`) keeps its laws in an in-source `import.meta.vitest` block in the module that owns it. That block keeps only `∀kv_HashContent_≡KnownAnswerVectors`, because a prior report's fingerprints are a published input, and no laws that only restate the hashing library.

### Consequences

- Good, because every branching decision is mutated, and a surviving mutant points at one workflow.
- Good, because the order of the sandwich phases is checked by the compiler, not by reading.
- Good, because `Effect.fn` names give spans without hand-written tracing.
- Bad, because pure helpers that do not decide anything still live in workflow modules. Workflow files get larger, and the mutator spends effort on code that only transforms data.
- Bad, because the composition root and cells have no unit tests. A regression on a CLI flow the e2e fixtures miss is caught only by the e2e lane.
- Neutral: `packages/frameworks/**` and `packages/ignorers/**` stay Effect-free, as their AGENTS.md files require. This taxonomy does not apply to them.

### Confirmation

- Review checks each changed file against the taxonomy table.
- A throwaway audit over non-test `packages/*/src` expects zero `*.parts.ts`, zero `*.steps.ts`, zero `Cell.fromEffect` stage wrappers, and zero `Ref.getUnsafe` or `Ref.makeUnsafe`. It also expects Promise and `throw` sites only under `src/drivers/`.

## Pros and Cons of the Options

### Keep the current layout

- Good, because nothing moves.
- Bad, because parts files hide decisions from the mutation gate and let callers bypass cells.

### Closed taxonomy, parts and steps retired

- Good, because each file's role is fixed by its suffix, and lint and mutation rules key on those suffixes.
- Bad, because it means a large one-time rewrite.

### Plain `Effect.fn` services without the cell library

- Good, because it has less vocabulary.
- Bad, because it loses the type-carried sandwich order (CONST-B6) and the exhaustive write handlers that the packs and the existing exemplar cells depend on.
