---
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-typescript-checker": major
---

Source locations are 1-based and validated end to end. `Mutant.Location`, `Mutant.Position`, `Mutant.Span`, `Mutant.OpenEndLocation`, `Mutant.ScriptOrigin`, and `Mutant.LineStarts` replace the former `LocationSchema`, `PositionSchema`, and `OpenEndLocationSchema`; a location whose end precedes its start, or a line or column below 1, no longer decodes.

- A mutant location always speaks the report contract, so a producer that minted 0-based coordinates or a bare number must switch to the new schemas.
- An embedded script's origin is a `ScriptOrigin` (1-based line plus a column shift), not a position.
- Incremental state from releases that stored the earlier column base is no longer matched: those mutants are re-tested, not reused, while the run rewrites the state.
