---
title: A kernel module's property suite has no legal home — the location rule and the authoring rule name different instruments
date: 2026-09-17
category: tooling-decisions
module: effect-dmmf-taxonomy
problem_type: tooling_decision
component: testing
related_components: [engine, lint-family]
severity: medium
applies_when:
  - "Adding a property suite for a module that is not a `*.workflow.ts` (a kernel, policy, or plain decision module)"
  - "A plan's test-classification table admits a colocated `*.property.test.ts` under `src/`"
  - "Deciding where a pure kernel module's invariants get pinned"
symptoms:
  - "A property suite placed under `src/__tests__/<stem>.property.test.ts` fails `effect-dmmf(src-property-test-cell)` and `effect-dmmf(no-test-file-in-src)`"
  - "Relocating it under `tests/` makes it silently not run — the vitest `include` lists only `tests/**/*.integration.test.ts`"
  - "The in-source home the location rule names cannot reach `it.prop`, so the suite cannot be written the way the authoring rule requires"
tags: [lint-family, property-tests, taxonomy, in-source-tests, test-placement, effect-dmmf]
---

# A kernel module's property suite has no legal home

## Problem

Two instruments disagree; a pure kernel module sits in the gap.

**The location rule** (`effect-dmmf(src-property-test-cell)`, `effect-dmmf(no-test-file-in-src)`), verbatim from its fix text:

> "a property test named `<stem>.workflow.property.test.ts` inside `__tests__`, beside the `<stem>.workflow.ts` it covers … a kernel/policy/schema property suite has no file home under the new taxonomy — convert it to an in-source `if (import.meta.vitest)` block in the module it covers."

**The authoring rule** (`architect-property-tests` C3):

> "Properties run through `@effect/vitest`, never raw `fc.assert` … write properties as `it.prop(...)` or `it.effect.prop(...)`."

In this repo `it.prop` is published by `@systemfsoftware/effect-gherkin-spec`. An in-source block is a module-scope `if (import.meta.vitest)` conditional: it cannot `await import` that harness at that position, and `import.meta.vitest`'s own `it` carries no `.prop`. The location rule's only sanctioned home and the authoring rule's only sanctioned API have an empty intersection for a kernel module.

Failure mechanics, in order:

1. The suite is written at the only location that seems to fit (`src/__tests__/<stem>.property.test.ts`) and typechecks, then `pnpm lint` refuses it on both placement rules.
2. Relocating to `tests/` satisfies neither rule and does not even execute: the engine's `sharedConfig` sets `include: ['tests/**/*.integration.test.ts', 'src/**/__tests__/*.test.ts']`, so `tests/<stem>.property.test.ts` is collected by nothing.
3. The in-source conversion the rule prescribes cannot carry `it.prop`; the only remaining API (`fc.assert`) is the one C3 bans.
4. Net effect: the kernel module ends with no property suite, and the invariant silently rides the integration lane instead.

Placement is not the whole contract; the name is mechanical too. `effect-dmmf(pbt-naming)` demands `[ScopeSymbol][binder]_[Domain]_[PredicateSymbol][operand]` with exactly two underscores and a relation symbol starting the last segment (`≡ ≠ = ≤ ≥ ∈ ⊆ ⊇ → ¬ ∘ ∩ ∪ ⊥`), e.g. `∀x_DecodeEncode_=x`; `∀m_Counts_Sum_≡Total` is rejected. `no-ternary` applies inside the predicates as well.

## Architectural invariants

**INV-1 — Instrument alignment.** A test artifact is legal only when its _location_ rule and its _authoring_ rule can both be satisfied by the same file. When a rule pair has an empty intersection, the gap is a rules defect, not a code defect; the correct action is to name the gap to the owner of the rules and not to reshape code around it.

**INV-2 — Placement is decided by what runs, not by what compiles.** A test file that no runner's `include` glob matches is a comment. Before writing a suite, read the runner config's `include`/`includeSource` and place the file where the glob reaches it.

**INV-3 — A taxonomy with no home for an artifact class cannot enforce that class.** The kernel/policy case is a declared hole ("has no file home under the new taxonomy"); a rule that forbids every placement and prescribes an API that its own sibling rule forbids has zero enforcement power over that class — the suite is simply absent, and absence reads green.

```
legal(suite) ⟺ placement(suite) ∈ allow(runner.include) ∧ api(suite) ∈ allow(authoring-rule)
kernel module ⇒ placement options = { in-source block }        # location rule
kernel module ⇒ api options       = { it.prop, it.effect.prop } # authoring rule
in-source block ⇒ api options     = { raw fc.assert }           # no await → no it.prop
⇒ legal(kernel property suite) = ∅
```

## Guidance

- **Classify the module first.** `<stem>.workflow.ts` → the suite is `src/<path>/__tests__/<stem>.workflow.property.test.ts`, and the DMMF name contract applies. Anything else → write no property suite.
- **Never rename a kernel module to `<stem>.workflow.ts` to obtain the location.** A workflow is a decision-over-command type; the name is a contract, not a parking space.
- **`tests/` is not an escape hatch** for the engine: only `tests/**/*.integration.test.ts` is collected there. Kernel invariants that must exist belong in an integration suite that calls the kernel through the composition, not in a misnamed property file.
- **The in-source home is real infrastructure, not a workaround.** `includeSource: ['src/**/*.ts']` is on; every package's `tsdown.config.ts` sets `define: { 'import.meta.vitest': 'undefined' }`, so the blocks are dropped from the build; `@systemfsoftware/stryker-ignorer-in-source-vitest-block` strips their mutants so they cannot inflate a mutation score. What is missing is a sanctioned `it.prop` shape inside such a block — that is the rules change that closes this gap.
- **When the plan admits a property test the taxonomy refuses, record the conflict** rather than shipping a suite the lint refuses or a suite that never runs.

## Applicability

Applies when pinning invariants on a pure module that is not a `*.workflow.ts`. Closes by a taxonomy change (give the kernel class a home) or by publishing an in-source `it.prop` shape — both owned by the author of the `effect-dmmf` rules, never by the agent adding the suite.
