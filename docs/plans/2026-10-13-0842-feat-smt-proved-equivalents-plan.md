---
title: SMT-Proved Equivalent Mutants - Plan
type: feat
date: 2026-10-13
topic: smt-proved-equivalents
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# SMT-Proved Equivalent Mutants - Plan

## Goal Capsule

- **Objective:** a default stryker-js-effect run never runs or scores a mutant that it can prove equivalent to the original program. Each such mutant is reported as Ignored with a proof that anyone can replay from the report alone, and no kill signal is lost.
- **Means:** small pure functions over `number` and `boolean` are encoded into the SMT-LIB FloatingPoint and Bool theories and decided by `z3-solver`.
- **Product authority:** the root's T12 intent of 2026-10-13, which pre-approves `z3-solver` and supersedes the root's 2026-10-09 rejection of SMT (recorded in `docs/plans/2026-10-09-2024-feat-mutant-subsumption-plan.md`, Key Decisions), then `CONSTITUTION.md`. Stream C owns `constant-collection-size` (#304). Stream H owns the checker's type queries (#328). Stream K and the root own `.github/workflows/`. Stream F owns native mutant generation later.
- **Open blockers:** `async-mutex`, the only runtime dependency of `z3-solver`, needs approval (Q2). It blocks implementation, not planning. The root's scorecard and SOTA-bar documents (`~/.kiro/crew/workspace/plans/2026-10-13-0000-stryker-sota-*.md`) are not readable from this workspace, so this plan works from the gap the root quoted: "no z3/SMT solver; static subsumption already exists".
- **Applicable packs** (`.compound-engineering/config.yaml`): `cell-architecture` (`pure-decision-workflows`, `four-channel-contracts`), `boundary-testing` (`pin-dependency-semantics`, `real-system-oracles`), `schema-laws` (`tagged-unions-over-state-by-presence`, `rich-type-over-foreign-encoded`).

---

## Product Contract

### Summary

Each mutant inside a small pure numeric or boolean function gets a fact: the original function and the mutated function as one serializable term pair. The engine encodes the pair as an SMT-LIB query asserting that the two functions return different values for some input. When `z3-solver` answers `unsat`, the mutant is Ignored as `proved-equivalent` and its record carries the query and the solver identity, so the proof can be replayed. Every other answer keeps the mutant.

### Problem Frame

`main` already removes three kinds of equivalent mutant, and none of them proves semantic equivalence:

| Mechanism on `main`                | Where                                                                                                          | What it catches                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Printed-code equivalence           | `packages/stryker-js-instrumenter/src/mutant-set-policy.workflow.ts:110-124` (`equivalent-to-original`)        | a replacement that prints as the original            |
| Trivial compiler equivalence (TCE) | `packages/stryker-js-typescript-checker/src/classify-tce.workflow.ts:69-76`, `check-mutants.workflow.ts:41-44` | a mutant whose emitted JS equals the original's      |
| S1 relational subsumption          | `subsume-mutants.workflow.ts`, `readmit-subsumed.workflow.ts` (PR-A, #273)                                     | a mutant dominated by a kept mutant; not equivalence |

A mutant whose JS differs but whose behaviour does not is never removed. It is reported Survived and lowers the score until someone writes a `// Stryker disable` comment. No shipped mutation tool proves such mutants equivalent with a solver by default. Stryker's own documentation says "there is no definitive way for Stryker to find and ignore them" (https://stryker-mutator.io/docs/mutation-testing-elements/equivalent-mutants/), and PIT, cargo-mutants, mutmut and Dextool have no solver step either. The research line is Offutt and Pan's constraint-based detection (STVR 7(3), 1997), Nequivack's KLEE equivalence check (ICSTW 2016), and Alive2's bounded SMT translation validation (PLDI 2021).

**Measured on the corpus.** All counts below come from main Mutation run 38363576433 (`mutation-report-463`, `381b3f5b1`): 12,239 mutants, 1,307 Survived and 497 NoCoverage. A parse-only classification of each mutant's enclosing function found:

- 43 mutants in 12 functions inside the 2026-10-09 fragment, of which 14 Survived, 22 Killed and 7 Ignored. R1's sort discipline can only shrink that set. Only a Survived or NoCoverage mutant can be equivalent.
- A scratch `z3-solver` 5.2.0 run under Node 24.21.0 proves exactly one of the 14 equivalent: `87ac4fce39ccfec2` (`flooredTimeoutOf`, `timeout < MUTANT_TIMEOUT_FLOOR_MS` → `<=`, `packages/stryker-js/src/plan-mutant-tests.workflow.ts:155-159`) is `unsat` in 65 ms.
  - `maxOf`/`minOf` `<` → `<=` (`e65ee3e59dbf8148`, `4868200158d404eb`) are `sat` at `left = +0, right = -0`.
  - The other eleven differ on ordinary inputs and are test gaps.
- Admitting any parameter type, with reads of property chains rooted at a parameter, raises the fragment to 171 mutants and 53 candidates. None of the 39 new candidates is equivalent within its function.
  - One (`bed85e7411fe8802`, `index >= 0` → `> 0` under `Option.getOrElse(Option.filter(…), () => 0)`) is equivalent only in its calling context, through Effect's `Option` combinators.
- `87ac4fce39ccfec2` is also the S1 dominator of `00d226d153f913c3` (`<` → `>=`). In kill matrix `kill-matrix-463` the dominator is Survived after 17 tests and the subsumed mutant is Killed by 1 of 17. Proving the dominator equivalent re-admits the subsumed mutant (R8). So on the corpus the change removes one equivalent survivor from the score and leaves the executed-mutant count unchanged.

The corpus is Effect-style decision code with few numeric helpers. Projects with more arithmetic would see more proofs, but no number for them can be measured without a mutation run on an outside corpus.

### Key Decisions

- **The fragment is the 2026-10-09 design's R21 fragment, narrowed so that every operator applies only to the sorts its encoding takes.** JS coerces mixed sorts (`true + 1` is 2, `1 == true` is true), and a sort-checked fragment needs no coercion table. Widening to property reads measured 0 additional proofs on the corpus. Governs R1, R2, R3, R5.
- **Equivalence is claimed for calls that respect the declared parameter types.** TypeScript types do not hold at runtime, so a caller using `as any` is outside the claim, and the proof states its domain. This is the same standard TCE uses: equivalence under the compiler's semantics. Governs R2, R10.
- **Output equality is `SameValue`.** Tests compare with `Object.is` (`toBe`), which separates `+0` from `-0`, so `===` equality would drop mutants that a test can kill (`maxOf`). Governs R6.
- **Only `unsat` drops a mutant.** Governs R7.
- **The proof is a typed record, not reason text.** The reason string stays human-readable. Replay reads the record. Governs R10, R11, R12.
- **On by default, solver loaded lazily.** A run with no eligible mutant never loads the 35.8 MB WASM. `mutator.mutantSetPolicy: 'full'` keeps every mutant, as it does for every other policy drop. Governs R14.
- **A proved-equivalent dominator counts as not run.** The existing re-admission rule then decides its subsumed mutants (unit I's R5). Governs R8.
- **Verdicts are decided on every run, not remembered.** A query costs milliseconds, and a remembered proof could outlive the source it proved. Governs R9.

### Requirements

**Eligibility**

- R1. A mutant gets an equivalence fact only when its innermost enclosing function is an arrow function or function declaration whose body is an expression or a single `return` of one. Every operator in the body applies only to the operand sorts listed with it:
  - parameters; `number` and `boolean` literals; module-level `const` bindings whose initializer is such a literal, resolved by lexical binding so that a parameter shadows a module `const`;
  - on `number`: unary `-` and `+`; binary `+`, `-`, `*`, `/`; `<`, `<=`, `>`, `>=`;
  - on two operands of the same sort: `===`, `!==`, `==`, `!=`;
  - on `boolean`: `!`, `&&`, `||`;
  - `c ? a : b` and `Boolean.match(c, { onTrue: () => a, onFalse: () => b })` with `c` a `boolean` and `a`, `b` of one sort;
  - calls with at least one `number` argument to `Math.abs`, `Math.min`, `Math.max`, `Math.floor`, `Math.ceil`, `Math.trunc`, `Math.sign`, or to a module `const` bound to one of them.

  The function has no loops, no recursion, no generics, no captured `let` or `var`, and at most a fixed node count.
- R2. Every parameter is declared with the `number` or `boolean` keyword, and `Boolean` is the namespace import of `effect/Boolean`. Any other parameter type, alias or import means no fact. A `number` parameter ranges over every double, NaN, ±0 and ±∞ included.
- R3. The mutant's replacement is itself drawn from the R1 fragment. `%`, `**`, bitwise operators, `Math.round`, strings, bigint and objects anywhere in the function or the replacement mean no fact.
- R4. The fact is a serializable term pair with parameter sorts, independent of parser nodes, emitted where the AST is held. A native generator can emit the same fact.

**Encoding and decision**

- R5. Encoding is a pure, total function from a fact to SMT-LIB2 text.
  - `number` becomes `(_ FloatingPoint 11 53)` and `boolean` becomes `Bool`. A literal is written as the exact IEEE-754 bits of its JS value, so `0xff`, `1_000` and integers above 2^53 encode as V8 reads them.
  - Arithmetic maps to `fp.add`, `fp.sub`, `fp.mul` and `fp.div` under `RNE`. Unary `-` maps to `fp.neg`, and unary `+` on a number is the identity.
  - Comparisons map to `fp.lt`, `fp.leq`, `fp.gt`, `fp.geq`, and number equality to `fp.eq`. These are false whenever NaN is involved, and `fp.eq` treats `+0` and `-0` as equal. Boolean equality is `=`, and `!`, `&&`, `||` are `not`, `and`, `or`.
  - `?:` and `Boolean.match` become `ite`.
  - `Math.floor`, `ceil` and `trunc` map to `fp.roundToIntegral` with `RTN`, `RTP` and `RTZ`, and `Math.abs` to `fp.abs`. `Math.min`, `max` and `sign` get explicit encodings of the ECMA-262 NaN and ±0 rules (`Math.sign` returns ±0 unchanged), because the FP theory defers `fp.min`/`fp.max` to IEEE-754, where ±0 is unspecified.
- R6. The query declares one unconstrained constant per parameter and asserts that the two function bodies are not equal under SMT `=`, which on FloatingPoint terms is `SameValue`: the theory has exactly one NaN, and `+zero` and `-zero` are distinct values.
- R7. Only `unsat` drops the mutant. `sat`, `unknown`, a resource-limit or wall-clock stop and a solver error keep it, and a solver failure never fails the run.
- R8. A mutant dropped as proved equivalent never counts as a running dominator. A mutant it subsumes is re-admitted when none of that mutant's dominators runs.
- R9. Every query runs under one fixed solver resource limit, with a wall-clock ceiling as backstop. Queries stopped by the wall clock are counted in R15. Verdicts are not remembered between runs.

**Proof and reporting**

- R10. A proved mutant is Ignored with the new rule id `proved-equivalent` and the reason `proved-equivalent: z3-solver <version> unsat`. Its record carries a typed proof:
  - the solver name and exact version, and the encoding version;
  - the resource limit;
  - the full query text and the verdict `unsat`;
  - the parameter domain.
- R11. The typed proof travels unchanged on the plugin `Mutant`, the NDJSON run-event line, the incremental record and `mutation.json`. Each surface's schema decodes it, and a record with a malformed proof fails decoding.
- R12. A replay path reads a report, re-runs every proof's query with the pinned solver, and fails unless each one answers `unsat` at the recorded limit. It needs no source checkout and no state beyond the report.

**No signal loss**

- R13. On every PR from this unit on, CI checks each proved drop against main's newest full kill matrix, which runs every mutant against every covering test:
  - Killed, Timeout, RuntimeError or CompileError fails, because the encoding is then unsound;
  - Survived or NoCoverage passes, as evidence consistent with the proof, not as proof;
  - a drop with no matrix entry is listed as unjoinable.

  The same check runs R12's replay. Soundness rests on R5's construct-by-construct mapping onto the cited theory, on R17, and on this check.

**Footprint**

- R14. `z3-solver` is pinned to one exact version and is a dependency of `@systemfsoftware/stryker-js` only. Exactly one module imports it. The solver loads only when at least one fact exists, and its worker threads are terminated before the run ends.

**Measurement**

- R15. Before and after counts come only from CI, cited by run id:
  - planned mutants; Ignored per rule id; re-admitted mutants;
  - executed mutants (Killed + Survived + Timeout + RuntimeError); Σ `testsCompleted`;
  - solver queries by verdict, queries stopped by the wall clock, and total solver time.

  The baseline is run 38363576433. The after figure is the first main Mutation run after the release that carries this unit.

**Tests**

- R16. The eligibility, encoding and verdict decisions get colocated property tests. A construct outside R1-R3 yields no fact, including mixed-sort operands and a zero-argument `Math.min`. A parameter that shadows a module `const` is read as the parameter. Every verdict except `unsat` keeps the mutant.
- R17. A differential spec checks the encoding against the JS engine with the real solver. It runs over generated fragment terms and doubles that include NaN, ±0, ±∞, subnormals and boundary values, and compares by `SameValue`. It samples; R13 is the corpus check.
- R18. Integration tests exercise the engine's public run surface with no process spawn. They cover R10's record, R8's re-admission, and R12's refusal of a tampered proof.
- R19. The typed proof's schema gets codec laws, and a refusal law beside them rejects a proof whose verdict is not `unsat`.

### Acceptance Examples

- AE1. **Covers R6, R7, R10.** In a fixture holding a `flooredTimeoutOf`-shaped function (`timeout < 100 ? 100 : timeout` through `Boolean.match`), the `<=` mutant is Ignored `proved-equivalent: z3-solver 5.2.0 unsat`, its proof replays as `unsat`, and it never reaches the checker or a runner.
- AE2. **Covers R6, R7.** In a `maxOf`-shaped fixture, the `<=` mutant gets `sat` with the model `left = +0, right = -0` and runs.
- AE3. **Covers R8.** In AE1's fixture, the S1-subsumed `>=` mutant names the proved `<=` mutant as its dominator, is re-admitted, and runs.
- AE4. **Covers R12.** A report whose proof query has been edited so that it is satisfiable fails replay and names the mutant id.
- AE5. **Covers R1, R3.** A function using `%`, or `flag + 1` with `flag: boolean`, yields no fact, and its mutants run.
- AE6. **Covers R7, R9.** A query stopped by the resource limit keeps its mutant, and R15 counts it.
- AE7. **Covers R13, R15.** On the corpus, the first main Mutation run after release shows `87ac4fce39ccfec2` Ignored `proved-equivalent` and `00d226d153f913c3` re-admitted, and the R13 check reports `87ac4fce39ccfec2` Survived in the kill matrix.

### Scope Boundaries

- Out: equivalence in calling context, such as `bed85e7411fe8802` through Effect's `Option` combinators. That needs a model of library semantics.
- Out: property reads, strings, bigint, `%`, `**`, bitwise operators and `Math.round`, each for a reason measured or cited above.
- Out: the shapes Stream C's `constant-collection-size` claims (#304), and type-invalid mutants (unit I, PR-C).
- Out: learned or LLM-based equivalence detection.
- Out: editing `.github/workflows/`, `PROJECTS` or `mutate` globs. R13 rides on whatever placement the root rules for `drop-audit` (#288).

<!-- ce-section: work-relationships -->

### How This Work Fits Together

This plan covers proved equivalence only. The rest is the current understanding, not a committed roadmap.

- Unit I Layer 1 (S1 subsumption, merged): R8 extends its re-admission rule.
- `drop-audit` (#288, open): R13 depends on where the root places it. Its audit is dominator-only today (`packages/stryker-js/src/audit-request.cell.ts:154-158`), so a non-dominator drop needs a second predicate.
- Stream H's type queries (#328, open): not needed. R2 reads declared keyword types, not inferred ones.
- Stream F native generation: can emit R4's fact later.

### Outstanding Questions

- Q1. **Build at this yield?** On the corpus the unit disposes one equivalent survivor and saves no executed mutant (Problem Frame). The 2026-10-09 rejection rested on the same count; T12's intent orders the outcome anyway. Deferred to the plan gate (root).
- Q2. **Approve `async-mutex`.** `z3-solver` 5.2.0 depends on `async-mutex ^0.3.2` (MIT, single maintainer `dirtyhairy`). It blocks implementation (supervisor).
- Q3. **Package boundary.** Approval of `z3-solver` puts 35.8 MB into every install of `@systemfsoftware/stryker-js`; a separate plugin package would keep it optional, but Stream A is splitting packages. Deferred to planning, with the root deciding if a new package is chosen.
- Q4. **Replay surface.** R12 can extend `stryker audit` or be its own command. Deferred to planning.
