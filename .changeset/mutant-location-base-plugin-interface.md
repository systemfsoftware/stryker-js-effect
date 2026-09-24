---
"@systemfsoftware/stryker-js-plugin-interface": patch
---

The position a checker receives for a mutant is now documented as 1-based
coordinates — the first line of a file and the first character of a line both
sit at the first position. A checker written against the earlier description,
which called the coordinates 0-based, placed mutants one line away from the
mutation.
