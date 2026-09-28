---
title: A mutant switch placed on a conditional's test must print parenthesized
date: 2026-09-27
category: runtime-errors
problem_type: printed mutant switch re-associates with the enclosing conditional
input_shape: solution
subject: The printed activation switch re-associates with the outer conditional, so the branch structure disappears and every test mutant leaks its replacement as the whole value
applies_when:
  - placing an expression mutant on the test of a conditional expression
  - changing how the printer renders a ConditionalExpression or any node the expression placer synthesizes
  - asserting that a printed mutant behaves as the proposal rather than as the placed tree
---

# A mutant switch placed on a conditional's test must print parenthesized

The expression placer replaces a mutated node with the activation switch
`stryMutAct_9fa48(id) ? replacement : original` — itself a conditional
expression. When that node is the **test** of another conditional, the printer
emitted the switch bare, so the emitted program ran the switch as the outer
conditional and handed the branch structure to its alternate. A survivor
reported Killed: `(count > 0 ? 'yes' : 'no')` under the `true` mutant returned
`true`, and the report read `expected true to be 'yes'`.

Spans, replacements and locations were all correct. Only the parse of the
printed text was not — and that parse is the artifact every consumer runs.

## Problem

`?:` is right-associative and its test slot takes a `ShortCircuitExpression`,
so one placed tree prints as two different programs:

```
(A ? R : T) ? C : Alt   # placed: the switch covers the test only
A ? R : T ? C : Alt     # printed: parses as A ? R : (T ? C : Alt)
```

Placement owes the report a re-parse equality, not a tree equality:

$$
\text{emitted} \equiv \text{placed} \;\Longleftarrow\; \text{reparse}(\text{print}(\text{placed})) = \text{placed}
$$

Precedence alone cannot express the rule: `needsParens` sees equal parent and
child precedence here and falls through to
`equalPrecedenceNeedsParens(isRight=false)` — correct for a left operand of a
left-associative operator, wrong for the test of a right-associative one. The
defect is silent in every syntactically delimited slot (`if`, `while`, `for`,
an argument list) and in the consequent and alternate slots, where a bare
same-precedence child still re-parses to the placed tree.

## Architectural invariants

**INV-1: Exact placement is re-parse equality.** A mutant's `location` and
`replacement` describe a tree; the printed program is what runs, so a print
that re-associates has moved the replacement to a different node. Gate: the
placement differential feature — a mutant's status cannot distinguish the two.

**INV-2: A slot rule belongs in the printer's wrapped-kinds table.**
`conditionalExpressionText` reads `CONDITIONAL_TEST_WRAPPED_KINDS` for the test
slot, beside the member-object, callee, unary-operand and array-element
records. A bare `ConditionalExpression` in that slot is a grammar violation, so
the entry is required rather than cosmetic.

**INV-3: Source paren preservation is not printer coverage.** oxc keeps written
parens as `ParenthesizedExpression` nodes, so a hand-written line round-trips
while a synthesized tree does not. Every parenthesization rule must be
justified by the grammar of the slot, never by the input having carried parens.

## Code smells

- `wrapIfNeeded(..., isRight: false)` on a test slot whose operator is
  right-associative, or any equal-precedence call that leans on the caller's
  grammar instead of the slot's.
- A synthesized node — a switch, a coverage sequence, an IIFE wrapper —
  reaching a slot with no wrapped-kinds entry.
- A placement test that asserts only mutant status, never that the program with
  the mutant active equals the program with only that node rewritten.
- A `statusReason` naming the replacement's own value on a mutant of a
  condition (`expected true to be 'yes'`) — the switch leaked into the value
  position instead of the condition position.

## Verification

`conditional-test-placement.integration.test.ts` instruments a shape table,
writes each mutant's module and each spliced reference module (the mutant's
`replacement` over its own `location`) to a scratch directory, activates the
mutant **before** importing — an exported arrow's switch is evaluated at module
load — and asserts the observed values agree for every mutant. Emptying
`CONDITIONAL_TEST_WRAPPED_KINDS` red-fails every ternary shape; restoring the
entry turns it green.

Adjacent hole, not fixed here: `classHeritageText` prints `superClass` at
`PREC.Assignment`, so a mutant switch over a class heritage prints bare too —
`class Derived extends []` with the `ArrayDeclaration` mutant emits
`extends stryMutAct_9fa48("0") ? ["Stryker was here"] : []`, which oxc refuses
(`Expected { but found ?`). That slot takes a `LeftHandSideExpression` and needs
the same treatment.
