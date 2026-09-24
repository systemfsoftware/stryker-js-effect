---
"@systemfsoftware/stryker-js-plugin-interface": major
---

Exit-code, timeout-reason and trace-context helpers are replaced by schemas and codecs.

- Replace `EXIT_CODE` with the `ExitCodeFromClass` codec.
- Replace the hit-limit and wall-clock helpers with `HitLimitReason`, `HitLimitReasonPrefix` and `WallClockTimeoutReason`.
- Replace `formatTraceparent` and `parseTraceparent` with encoding and decoding through `Traceparent`, and the header constants with `TraceparentHeader` and `TracestateHeader`.
- Build `CheckerMutantWire` values from the instrumenter's `MutantId`, `CanonicalFileName` and `MutatorName`.
