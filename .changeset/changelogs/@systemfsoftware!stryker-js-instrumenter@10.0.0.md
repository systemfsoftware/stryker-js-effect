## 10.0.0

### Major Changes

- Rendering a caught cause is a function now, not a method on a schema class. `ErrorText.errorTextOf(cause)` and `ErrorText.causeTextOf(cause)` replace `ErrorText.ErrorText.fromCause(cause)` and `ErrorText.CauseText.fromCause(cause)`.

  Replace the two calls: `ErrorText.ErrorText.fromCause(cause)` becomes `ErrorText.errorTextOf(cause)`, and `ErrorText.CauseText.fromCause(cause)` becomes `ErrorText.causeTextOf(cause)`. Both return the same `Option.Option<ErrorText>` and `Option.Option<CauseText>` as before. The `ErrorText` and `CauseText` classes, their value types, and `ErrnoException` are unchanged.

- File names handed to `instrument` are canonicalized: a backslash in an input path is folded to `/`, in the returned file names and in each mutant's file name alike. A result now reports one spelling of a path, matching the spelling `Mutant.fileName` already used, instead of echoing whatever separator the caller passed.

  No call-site change is needed — keep passing plain strings to `instrument`.

- Mutant ids are decimal index strings. Every schema that carried a mutant id as a plain string now decodes `Mutant.MutantId` and refuses anything else: the mutation report and its mutant results, reporter events (`mutationTestingPlanReady` plans, `mutantTested`), the machine run stream (`mutant` and `verdict`), the survivors prior report, and the mutant coverage keys produced by test runners.

  Mutant ids are minted only as the mutant's canonical non-negative decimal index (`Mutant.MutantId`), including in the instrumenter's planned mutants, placement sites, and checker answers. Consume the new `Mutant.MutantId` schema instead of assuming an arbitrary non-empty string; ids such as `constructor` or `__proto__` no longer decode.

- A mutant's status is declared once, as the eight-value `Mutant.MutantStatus`, plus the named subsets a run partitions on: `Mutant.SurvivorStatus`, `Mutant.RememberedStatus`, `Mutant.EphemeralStatus`, and `Mutant.ActionableStatus`. Import the subset your decision matches instead of re-listing the statuses you accept.

  Mutants are tagged structs now. A status reason decodes only together with a status, and the remembered-mutant and ignored-mutant rows carry the same narrowed status as the subset they were selected by.

- Source locations are 1-based and validated end to end. `Mutant.Location`, `Mutant.Position`, `Mutant.Span`, `Mutant.OpenEndLocation`, `Mutant.ScriptOrigin`, and `Mutant.LineStarts` replace the former `LocationSchema`, `PositionSchema`, and `OpenEndLocationSchema`; a location whose end precedes its start, or a line or column below 1, no longer decodes.

  - A mutant location always speaks the report contract, so a producer that minted 0-based coordinates or a bare number must switch to the new schemas.
  - An embedded script's origin is a `ScriptOrigin` (1-based line plus a column shift), not a position.
  - Incremental state from releases that stored the earlier column base is no longer matched: those mutants are re-tested, not reused, while the run rewrites the state.

### Patch Changes

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.
