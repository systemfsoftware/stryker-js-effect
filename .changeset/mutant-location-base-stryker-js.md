---
"@systemfsoftware/stryker-js": patch
---

The JSON report and the machine stream now name the same place for every
mutant. The report's columns ran one too high, and the stream's line and column
ran one and two too high, so a consumer that highlighted the mutated code from
either landed beside the mutation. Both now carry the mutant's 1-based line and
column.

An incremental run keeps reusing the results remembered in a report written
before this fix, so upgrading does not re-run a project's mutants once.
