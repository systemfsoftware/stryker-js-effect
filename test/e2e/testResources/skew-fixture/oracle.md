# Oracle — the skew-fixture mutation run

Hand-derived from the instrumenter's mutator registry, then confirmed against one run. Every
expected value below is reasoned from the fixture's assertions; the run may confirm the numbers and
never originate them (CONST-T10), so a disagreement is triaged as a fixture-authoring error or a
product bug rather than copied in as the new expectation.

`src/calc.ts` is byte-for-byte the source `testResources/calc-fixture` runs, so the derivation is
that fixture's derivation — re-derived here from the registry rather than copied from a run, and
stated in full so this oracle stands alone.

## What this fixture's oracle adds

The run is driven with `"checkers": ["skew"]`: every mutant is answered `{ "status": "passed" }` by a
checker worker built on a different Effect release, and grouped one-mutant-per-group. A passing
check never removes a mutant from the plan, and the identity partition adds no merge, so the counts
below are the counts of an unchecked run too. The journey therefore reads a verdict that is _shared_
with the plain run: what is new is that it arrived across the skewed worker boundary.

## The mutator catalog that applies

Source: `packages/stryker-js-instrumenter/src/Mutator.ts` — the registry `allMutators`.
`mutator.excludedMutations` is unset and its schema default is `[]`
(`packages/stryker-js-plugin-interface/src/Schema.schema.ts`), so the whole registry is active.

| Mutator                 | Fires on                  | Replacement rule                                                        | Count |
| ----------------------- | ------------------------- | ----------------------------------------------------------------------- | ----- |
| `ArithmeticOperator`    | `a + b` (line 3), `n * 2` | `+` → `-`, `*` → `/` (identifier operands are not string concatenation) | 2     |
| `ConditionalExpression` | `n > 0` (line 7)          | boolean expression → `true`, `false`                                    | 2     |
| `EqualityOperator`      | `n > 0` (line 7)          | relational `>` → its neighbours `>=`, `<=`                              | 2     |
| `BlockStatement`        | each of the three bodies  | body → `{}` (non-empty, not a constructor body)                         | 3     |

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

The verdict envelope publishes only the mutants it found **actionable** (`Survived` | `NoCoverage` |
`Timeout` | `RuntimeError`), so this fixture's verdict lists exactly two mutants — the two `double`
survivors. The full nine are observable as the `mutant` events the stream emits while the run
proceeds; the lane asserts the nine-mutant multiset from there and the actionable pair from the
verdict, which is the split each surface actually promises.

## Coverage, and why the survivors read as `Survived` and not `NoCoverage`

`coverageAnalysis` defaults to `perTest`. Under per-test coverage a mutant whose line no test
executes is reported as `NoCoverage` and never run. The third fixture test calls `double` — covering
lines 9-11 — so both of `double`'s mutants are run and reported as `Survived`. The lane therefore
expects `noCoverage: 0` alongside `killed: 7, survived: 2`.
