---
"@systemfsoftware/stryker-js": patch
---

`stryker merge-reports` now rebuilds a package's partial report from the mutants recorded in its stream part when the run ended before writing its final report. Earlier versions recognized none of the recorded mutants and reported the package as having no report.
