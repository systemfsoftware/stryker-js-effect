---
"@systemfsoftware/stryker-js-instrumenter": major
---

Mutant ids, mutator names and file names are now branded schemas, and the string helpers are replaced by codecs.

- Build ids and names with `MutantId`, `MutatorName` and `CanonicalFileName`. Empty values are refused.
- Replace `errorToString` with `ErrorText.fromCause` and `causeText` with `CauseText.fromCause`. Both return an `Option`.
- Replace `normalizeFileName` with a `CanonicalFileName` decode, and `isMutant` with `Schema.is(Mutant)`.
- Read the values formerly in `INSTRUMENTER_CONSTANTS` from the `InstrumenterContext` statics.
