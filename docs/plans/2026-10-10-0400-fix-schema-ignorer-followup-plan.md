---
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
status: implemented
---

# fix: schema-ignorer follow-up to #259 (X1-fu)

## Goal Capsule

Apply ruling D3 (`.omp-brief/c-x1-followup.md`) to the `effect-schema-declarations` ignorer that #259 merged. The reasons, keep-advice and docs must say what the `recursionBudget` rules do. The tests must assert the reason the ignorer emits on real source, not the package's own constants.

## Requirements

- R1 (P1): ignore the mutants inside a `recursionBudget` value in the first argument of `annotate`/`annotations`, whatever the object's other keys are. The annotate object stays mutated unless every other key is documentation. Refusal cases:
  - a non-documentation sibling (`toEquivalence: () => eq`) still yields mutants;
  - a `recursionBudget` key outside an annotate call is still mutated.
- R2: the reason code calls the value test/generation-only metadata, not an equivalent. `packages/ignorers/AGENTS.md` names its readers: the recursion-budget transform and runtime, and the effect-schema-law recursion laws.
- R3 (P2): the keep advice is correct for both budget codes, which removing the ignorer cannot keep. `KEEP_ADVICE` maps each code to its next action.
- R4 (P2): the README `What Stays Graded` section states the rule as implemented.
- R5 (P2): delete the reason assertions that compare against the package's exported constants. Assert literal emitted reasons on snippets run through `testIgnorer` (real parse and walk).
- R6 (P2): codes stay nested under the engine's `ignorer` rule id as `effect-schema-declarations/<code>`. `REASON_CODES` is the code list; the README documents the `statusReason` form.
- R7: patch changeset for the ignorer.

## Key Decisions

- KD1: R1 needs no detection change. `recursionBudgetSlotReason` already ignores the value subtree with no sibling condition. The new ignored case beside a behaviour hook proves it, where before only the object and the hook were pinned as kept.
- KD2: the expected reasons in the test are literal strings. They are an independent oracle for the code, the prefix and the meaning. If a code is renamed or the format changes, the suite goes red.

## Verification (G5, targeted)

`pnpm exec tsc -b`, `pnpm lint`, `pnpm api:update` and `pnpm exec vitest run` in `packages/ignorers/effect-schema-declarations`. The suite passes with `dist/` removed, which proves it grades `src/`. Mutators targeted: `ObjectLiteral` and `StringLiteral` in Schema annotate objects. There are no local mutation runs.
