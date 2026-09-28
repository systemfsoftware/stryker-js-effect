---
"@systemfsoftware/stryker-js-instrumenter": major
---

Mutant identity, status, location, coverage and run options are re-exported from `@systemfsoftware/stryker-js-plugin-interface` as `Mutant`; `Mutator` now holds the registry, catalog and selection, and `Source` holds `LineStarts`, `Offset`, `ScriptOrigin` and `Span`. A mutant switch on a conditional's test is printed in parentheses now, so a ternary-test mutant no longer replaces the whole conditional. Mutants ignored by a `// Stryker disable` directive no longer shift the placed replacements beside them, so every activated arm runs its own replacement.

Import the moved identity types from the plugin interface.
