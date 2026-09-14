---
title: Ignorer Plain Entry - Corrected Contract
type: refactor
date: 2026-09-14
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
supersedes: docs/plans/2026-09-14-0150-refactor-ignorer-standard-schema-plan.md
---

# Ignorer Plain Entry - Corrected Contract

## Goal Capsule

**Objective.** A plain ignorer module exports `strykerIgnorers: PlainIgnorer[]` where
`PlainIgnorer = { name, shouldIgnore(path: NodePath): string | undefined }`. The host
registers each entry as an `Ignore` contribution and fails the load by name when an entry's
`name` is not a string or its `shouldIgnore` is not callable.

**Correction.** The earlier plan required a `schema` member on every entry and had the engine
re-declare that member's shape in `effect/Schema`. Both are removed at the user's direction:
the descriptor carries no schema, and no shape is mirrored across the boundary.

**Authority.** User direction in session (2026-09-14), then `AGENTS.md` and `CONSTITUTION.md`.

**Verification.** `pnpm check:ci`; each package's `pnpm typecheck`, `pnpm run build`,
`pnpm exec vitest run`, `pnpm run lint`; `attw` per package; engine loader suite proves the
rejection path.

## Requirements

- R1. `PlainIgnorer` is `{ name, shouldIgnore }`; the interface publishes no descriptor schema.
- R2. The engine validates exactly that shape (`S.Struct({ name: S.String, shouldIgnore: S.declare(isShouldIgnore) })`)
  and registers entries as `Ignore` contributions.
- R3. Standard Schema types come from `@standard-schema/spec` (jsr, catalog-pinned), imported
  as a devDependency and inlined into the published declarations — no runtime dependency, no
  hand-copied spec source.
- R4. The interface keeps the AST vocabulary, `NodePath`, `ancestorsOf`, and the toolkit as the
  ignorers' internal implementation.
- R5. Docs, changesets, and the carried case tables state this contract.

## Unit Map

| Unit | Change                                                                                          | Verification                                                                       |
| ---- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| C1   | Interface: drop `PlainIgnorerSchema` and the `schema` field; import spec types from the package | interface typecheck/build/tests/lint; `dist/*.d.ts` free of `standard-schema/spec` |
| C2   | Two ignorers: entries are `{ name, shouldIgnore }`                                              | each package's suite (48/14 cases)                                                 |
| C3   | Engine: `PlainIgnorerSchema` = name + callable `shouldIgnore`; fixture set re-aimed             | engine suite; the invalid-entry fixture fails the load by name                     |
| C4   | Docs/changesets                                                                                 | prose states the two-field contract                                                |

## Destructive Review

**Assumptions.** (1) A host can meaningfully validate an ignorer without a declared schema;
(2) the interface's AST types suffice for authoring; (3) the toolkit remains worth shipping
internally. **Lens (inversion).** How would this be gamed? An entry could ignore nothing and
load green — accepted: ignoring nothing is visible as an unmutated run, and the case tables
pin each ignorer's real decisions. **Radical alternative.** Have the engine pass its own
Effect schema converted with `Schema.toStandardSchemaV1`. Rejected: it makes the host dictate
the input contract and re-couples authors to the host's toolkit. **Reconciliation.** No delta;
the corrected contract stands.
