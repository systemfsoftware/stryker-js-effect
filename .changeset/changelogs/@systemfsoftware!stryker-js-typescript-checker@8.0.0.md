## 8.0.0

### Major Changes

- Source locations are 1-based and validated end to end. `Mutant.Location`, `Mutant.Position`, `Mutant.Span`, `Mutant.OpenEndLocation`, `Mutant.ScriptOrigin`, and `Mutant.LineStarts` replace the former `LocationSchema`, `PositionSchema`, and `OpenEndLocationSchema`; a location whose end precedes its start, or a line or column below 1, no longer decodes.

  - A mutant location always speaks the report contract, so a producer that minted 0-based coordinates or a bare number must switch to the new schemas.
  - An embedded script's origin is a `ScriptOrigin` (1-based line plus a column shift), not a position.
  - Incremental state from releases that stored the earlier column base is no longer matched: those mutants are re-tested, not reused, while the run rewrites the state.

### Patch Changes

- The TypeScript checker describes a tsconfig document through the schema that declares the keys it interprets, so an override round-trips the document it was given, and the mutant it cannot describe to a checker carries the canonical file-name brand. The plugin contract, configurations, reports, and exit codes are unchanged.

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@10.0.0
  - @systemfsoftware/stryker-js-plugin-interface@10.0.0
