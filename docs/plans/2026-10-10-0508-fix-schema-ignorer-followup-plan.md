---
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
status: implemented
supersedes: docs/plans/2026-10-10-0400-fix-schema-ignorer-followup-plan.md
---

# fix: schema-ignorer follow-up to #259 (X1-fu)

## Goal Capsule

Apply ruling D3 and the review rulings appended to it (`.omp-brief/c-x1-followup.md`) to the `effect-schema-declarations` ignorer that #259 merged. The review rulings overrule the rejection of the "budget beside a behaviour key" finding, which supersedes the 0400 plan's R1. The reasons, keep-advice and docs must say what the `recursionBudget` rules do. The tests must assert the reason the ignorer emits on real source, not the package's own constants.

## Requirements

- R1 (P1, overruled review finding): ignore the mutants inside a `recursionBudget` value in the first argument of `annotate`/`annotations`, and the mutants of the object holding it, whatever the object's other keys are. The other keys' values stay mutated. Refusal cases:
  - a non-documentation sibling (`toEquivalence: () => eq`) still yields mutants inside its value;
  - a `recursionBudget` key outside an annotate call is still mutated.
- R2: the reason code calls the value test/generation-only metadata, not an equivalent. `packages/ignorers/AGENTS.md` names its readers: the recursion-budget transform and runtime, and the effect-schema-law recursion laws.
- R3 (P2): the keep advice is correct for both budget codes, which removing the ignorer cannot keep. `KEEP_ADVICE` maps each code to its next action.
- R4 (P2): the README `What Stays Graded` section states the rule as implemented.
- R5 (P2): delete the reason assertions that compare against the package's exported constants. Assert literal emitted reasons on snippets run through `testIgnorer` (real parse and walk).
- R6 (P2): codes stay nested under the engine's `ignorer` rule id as `effect-schema-declarations/<code>`. `REASON_CODES` is the code list; the README documents the `statusReason` form.
- R7: changeset for the ignorer (minor: the holder reason text and `RECURSION_BUDGET_HOLDER_IGNORED` change, and more mutants are ignored).
- R8: an instrumenter-level test on the discern shape `S.suspend(...).annotate({ recursionBudget, toEquivalence })` runs the real ignorer and the real recursion-budget transform. It asserts no live mutant inside the budget, the object ignored, the hook live, the full `ignorer: effect-schema-declarations/<code>: <meaning>` reason, and that the transform still injects the budget into the instrumented file.
- R9: one test drives real source through the instrumenter and asserts the `KEEP_ADVICE` entry each emitted code maps to.

## Key Decisions

- KD1: R1 needed a detection change. Before it, the holder object beside `toEquivalence` kept its `ObjectLiteral` `{}` mutant; mutant switching turns the annotate argument into a conditional, the transform skips it, and the dry run fails with `Budget_RequiresTransform`. R8 failed on that (`injected: false`) before the classifier change and passes after it.
- KD2: the expected reasons in the test are literal strings. They are an independent oracle for the code, the prefix and the meaning. If a code is renamed or the format changes, the suite goes red.

## Verification (G5, targeted)

`pnpm exec tsc -b`, `pnpm lint`, `pnpm api:update` and `pnpm exec vitest run` in `packages/ignorers/effect-schema-declarations`; `tsc -b`, `pnpm lint` and the new test file in `packages/stryker-js-instrumenter`. The ignorer suite passes with `dist/` removed, which proves it grades `src/`. Mutators targeted: `ObjectLiteral` and `StringLiteral` in Schema annotate objects. There are no local mutation runs.
