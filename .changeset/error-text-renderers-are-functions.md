---
"@systemfsoftware/stryker-js-instrumenter": major
---

Rendering a caught cause is a function now, not a method on a schema class. `ErrorText.errorTextOf(cause)` and `ErrorText.causeTextOf(cause)` replace `ErrorText.ErrorText.fromCause(cause)` and `ErrorText.CauseText.fromCause(cause)`.

Replace the two calls: `ErrorText.ErrorText.fromCause(cause)` becomes `ErrorText.errorTextOf(cause)`, and `ErrorText.CauseText.fromCause(cause)` becomes `ErrorText.causeTextOf(cause)`. Both return the same `Option.Option<ErrorText>` and `Option.Option<CauseText>` as before. The `ErrorText` and `CauseText` classes, their value types, and `ErrnoException` are unchanged.
