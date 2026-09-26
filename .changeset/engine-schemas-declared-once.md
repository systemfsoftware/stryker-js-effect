---
"@systemfsoftware/stryker-js": major
---

The engine's file matching, reporter names, CLI command list, ANSI colours, report stream file name and planned-mutant failures are each declared once. `FileMatcher` keeps only its pattern and hidden-file flag: it no longer carries a `matches` method.

- The removed `RelativeNormalizedFileName` is replaced by the engine's own normalization, and a report's stream file name is the literal the engine writes.
- `AnsiColor` is the type of the colour codes rather than a schema, and `CliCommandSchema` plus the reporter-name schemas name the command list and the reporter names.
- A mutant whose computed timeout is not a finite number now fails planning with the `MutantTimeoutNotFinite` failure naming that mutant.
