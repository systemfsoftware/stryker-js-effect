# Oracle — the calc-fixture mutation run

Hand-derived from the instrumenter's mutator registry, then confirmed against one run. Every
expected value below is reasoned from the fixture's assertions; the run may confirm the numbers and
never originate them (CONST-T10), so a disagreement is triaged as a fixture-authoring error or a
product bug rather than copied in as the new expectation.

One confirmation is recorded honestly: the first derivation listed 7 mutants and missed the two
`EqualityOperator` mutants of `n > 0`, because the catalog's relational path is easy to read as part
of `ConditionalExpression` alone. The table below carries all 9 with their reason, and the assertions
that follow from them.

## The mutator catalog that applies

Source: `packages/stryker-js-instrumenter/src/Mutator.ts` — the registry `allMutators` (line 1341).
`mutator.excludedMutations` is unset and its schema default is `[]`
(`packages/stryker-js-plugin-interface/src/Schema.schema.ts:115,166`), so the whole registry is active.

| Mutator                 | Fires on                                                       | Replacement rule                                                                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ArithmeticOperator`    | `a + b` (line 3), `n * 2` (line 11)                            | `arithmeticOperatorReplacements` (line 477): `+` → `-`, `*` → `/`. Guarded by `isSupportedArithmeticOperator` (line 499): operator in the key set AND `!isStringConcatenation` (line 506); identifier operands are not string-like, so both expressions mutate. **One mutant each.** |
| `ConditionalExpression` | `n > 0` (line 7)                                               | `conditionTestMutants` → `booleanExpressionMutants` → `booleanExpressionReplacements`: a boolean expression whose parent is neither `&&` nor `                                                                                                                                       |
| `EqualityOperator`      | `n > 0` (line 7)                                               | `equalityOperatorMutator` (line 917) → `mutatedEqualityOperators`, whose relational arm maps `>` onto its neighbours: **`>=` and `<=`**. This is the pair the first derivation missed. **Two mutants.**                                                                              |
| `BlockStatement`        | the body of each of the three functions (lines 1-3, 5-7, 9-11) | `blockStatementMutator` (line 657) → `isMutableBlock` (line 660) = `BlockStatement` AND `isValid` (line 663) = non-empty AND not a constructor body. Each function body qualifies. **One mutant each.**                                                                              |

Registry entries that cannot fire — no matching node exists in `src/calc.ts`: `ArrayDeclaration`,
`ArrowFunction`, `AssignmentOperator`, `BooleanLiteral`, `LogicalOperator`, `MethodExpression`,
`ObjectLiteral`, `OptionalChaining`, `Regex`, `StringLiteral`, `UnaryOperator`, `UpdateOperator`.

## Per-mutant verdicts

| # | Location                            | Expression | Mutator                 | Replacement                | Verdict  | Observed by                                                                             |
| - | ----------------------------------- | ---------- | ----------------------- | -------------------------- | -------- | --------------------------------------------------------------------------------------- |
| 1 | `src/calc.ts:3` (`add` body)        | `a + b`    | `ArithmeticOperator`    | `a - b`                    | KILLED   | "add adds its two operands" — `add(2,3)` = −1 ≠ 5                                       |
| 2 | `src/calc.ts:1-3` (`add` block)     | body       | `BlockStatement`        | `{}` (returns `undefined`) | KILLED   | "add adds its two operands" — `undefined` ≠ 5                                           |
| 3 | `src/calc.ts:7`                     | `n > 0`    | `ConditionalExpression` | `true`                     | KILLED   | "isPositive separates a positive number from zero" — `isPositive(0)` = `true` ≠ `false` |
| 4 | `src/calc.ts:7`                     | `n > 0`    | `ConditionalExpression` | `false`                    | KILLED   | same test — `isPositive(1)` = `false` ≠ `true`                                          |
| 5 | `src/calc.ts:7`                     | `n > 0`    | `EqualityOperator`      | `n >= 0`                   | KILLED   | same test — `isPositive(0)` = `true` ≠ `false`                                          |
| 6 | `src/calc.ts:7`                     | `n > 0`    | `EqualityOperator`      | `n <= 0`                   | KILLED   | same test — `isPositive(1)` = `false` ≠ `true`                                          |
| 7 | `src/calc.ts:5-7` (`isPositive`)    | body       | `BlockStatement`        | `{}` (returns `undefined`) | KILLED   | same test — `undefined` ≠ `false`                                                       |
| 8 | `src/calc.ts:11` (`double` body)    | `n * 2`    | `ArithmeticOperator`    | `n / 2`                    | SURVIVED | The only test that calls `double` pins no value: `double(3)` = 1.5 does not throw       |
| 9 | `src/calc.ts:9-11` (`double` block) | body       | `BlockStatement`        | `{}` (returns `undefined`) | SURVIVED | same test — `undefined` does not throw                                                  |

## Totals

```
killed: 7
survived: 2
total: 9
```

`7 + 2 = 9`: every derived mutant carries exactly one row, and the verdict's eight counts sum to the
same total.

## What the two observation surfaces carry

The verdict envelope publishes only the mutants it found **actionable**
(`isActionableStatus` = `Survived` | `NoCoverage` | `Timeout` | `RuntimeError`,
`packages/stryker-js-engine/src/verdict-envelope.ts`), so this fixture's verdict lists exactly two
mutants — the two `double` survivors. The full nine are observable as the `mutant` events the stream
emits while the run proceeds; the lane asserts the nine-mutant multiset from there and the actionable
pair from the verdict, which is the split each surface actually promises.

## Coverage, and why the survivors read as `Survived` and not `NoCoverage`

`coverageAnalysis` defaults to `perTest` (`packages/stryker-js-plugin-interface/src/Schema.schema.ts:5,139`).
Under per-test coverage a mutant whose line no test executes is reported as `NoCoverage` and never
run. The third fixture test calls `double` — covering lines 9-11 — so both of `double`'s mutants are
run and reported as `Survived`. The lane therefore expects `noCoverage: 0` alongside
`killed: 7, survived: 2`.
