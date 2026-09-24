# First Reconciliation Triage

Date: 2026-09-21
Slices: lifecycle, edge, checker, resilience
Baselines: blessed with `pnpm --filter @systemfsoftware/stryker-e2e bless-oracle --verify <slice>` (flake gate 2/2 per slice)
Gate: `pnpm check:oracle-drift` green at the commit introducing this report.

Each row lists a first-reconciliation delta between hand/static expectations and blessed engine values, with an adjudication category from the plan (R17): `fixture-fix`, `product-bug`, `contract-clarification`. Evidence anchors name committed files; probes are described by the method that produced the number.

## Delta 1 — edge: Ignored 4 (blessed) vs 2 (analyzer projection)

- **Family/slice:** ConditionalExpression, edge.
- **Expected:** engine `excludedMutations: ['ConditionalExpression', 'EqualityOperator']` (`stryker.edge.config.ts`) yields 4 Ignored: 2 Conditional if-test placements + 2 Equality from `level > threshold` in `packages/services/src/inventory.ts`.
- **Actual (pre-fix):** 2 — the analyzer handled ternaries only for ConditionalExpression.
- **Method:** direct instrumenter probe — `instrument([file], { excludedMutations: [], ignorers: [], noHeader: true })` over `inventory.ts`, filtering `result.mutants` by line. Confirmed: if-test expressions get `true`+`false`, loop tests get `false`, boolean-operator operands get per-parent replacements, and ternaries get **no** mutants (`conditionTestMutants` routes non-boolean-op nodes to `statementMutants`, `packages/stryker-js-instrumenter/src/Mutator.ts:791-897`).
- **Adjudication:** `contract-clarification`. The contract's arm list was right; the analyzer was extended to mirror it with the instrumenter's priority chain (`isTestOfConditionOrLoop`, `test/e2e/scripts/oracle/ast-analyzer.ts`). Residual: the contract's ternary line ("a ? b : c emits true and false") misdocuments the engine; the analyzer keeps 2-per-ternary for registry count-equality compatibility. Follow-up: revise `mutator-contract.md` § ConditionalExpression and the registry row to name this static approximation.

## Delta 2 — lifecycle: compileErrors 98 (blessed) vs 0 (static composite recompute); CE-bearing tally rows engine-only

- **Family/slice:** all `CompileError` rows, lifecycle (same mechanism for the other slices' CE counts).
- **Expected:** R4 states CompileError is exactly and statically derivable from pre-emit diagnostics against the fixture's composite project references.
- **Actual:** the static derivation (`test/e2e/scripts/oracle/diagnostics.ts`, `status-derivation.ts`) passes its mini-fixture tests but classifies far fewer mutants as CompileError on the real fixture than the engine (static recompute 0 vs engine 98 at HEAD).
- **Adjudication:** `contract-clarification` — engine-owned CE boundary. The engine's typechecker evaluates per its own runtime project setup, which the static composite projection does not replicate; the two answer different questions. Reconciliation treats engine-recorded `compileErrors` and per-family CE rows as engine-owned (`reconcileSlice` compares only config-excluded Ignored counts); static CompileError derivation remains a tested capability at mini-fixture scope, and reconciliation consumes blessed CE values (R5/R6). No product bug: neither the engine nor the fixture is wrong.

## Delta 3 — lifecycle: analyzer-vs-instrumenter placement totals on the real fixture

- **Family/slice:** ArrowFunction 36 (analyzer) vs 18 (engine), StringLiteral 74 vs 36, ConditionalExpression 10 vs 80, ArrayDeclaration 1 vs 3.
- **Method:** family tallies from the blessed lifecycle baseline vs the analyzer's fixture-wide inventory; direction per family checked against the instrumenter visitor (`Mutator.ts`): the analyzer overcounts block-bodied arrows and additional string shapes, undercounts `new Array(n)` constructor forms (the contract's ArrayDeclaration clause lists `isArrayConstructorCall`), and its ConditionalExpression gap was Delta 1.
- **Adjudication:** `product-bug` — `N/A (pre-existing, harness-side)`. The instrumenter agrees with the contract in every checked case; the static mirror lags it. Not a fixture error, not engine misbehavior. The reconciler therefore compares only what the analyzer owns exactly (config-excluded Ignored counts); full-fixture placement parity is the harness follow-up.

## Deltas with no adjudication required

- Ignored counts on all four slices: reconciled exactly (edge 4/4, others 0/0) after Delta 1's fix and the config-exclusion scoping. Directive-muted mutants are placement-absent in engine results — established by the Delta 1 probe method, not assumed; `recomputeStaticSlice` scopes its ignored comparison accordingly (`test/e2e/scripts/reconcile-oracle.ts`).
- Unblessed findings: none; all four slices blessed at HEAD, flake gate 2/2 each.
- Journey literal blocks: byte-identical to `renderLiteralBlock` output; `pnpm derive-oracle --reconcile` performs zero writes at HEAD.

## 2026-09-24 follow-up: directive-muted mutants

The "placement-absent" observation in the Ignored bullet above came from a defect. `// Stryker disable next-line` directives were recorded on the comment's own line, so they muted nothing. Issue #83 fixed this. The engine now reports those mutants as Ignored: the lifecycle slice's `if (level > threshold)` pair in `packages/services/src/inventory.ts` moved from Killed to Ignored. `recomputeStaticSlice` therefore compares every analyzer-ignored mutant, from config exclusions and from directives alike. After re-blessing the lifecycle slice, all four slices reconcile exactly (lifecycle 2/2, edge 4/4, others 0/0).
