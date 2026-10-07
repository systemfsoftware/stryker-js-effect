---
"@systemfsoftware/stryker-js": minor
---

A dry-run-only run with incremental mode on publishes its dry-run coverage to the incremental file, keeping any verdicts already there, so a later run that reads the file through incrementalSources skips its own dry run. The run-inputs digest no longer covers dryRunOnly, so a preflight and the runs that reuse its coverage share one digest; existing caches are refused once with runInputsChanged.
